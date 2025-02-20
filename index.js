/**
 * Plugin to remove `debug` from code.
 *
 * @returns {PluginObj}
 */
export default function ({types: t}) {
  return {
    name: 'remove-debug-imports',
    visitor: {
      Program: {
        exit(path) {
          // Tracks all identifiers that reference debug or debug instances
          const debugBindings = new Set()
          // Collects AST nodes that should be removed
          const pathsToRemove = new Set()
          // Tracks bindings from destructured debug objects
          const destructuredBindings = new Set()

          // First find all debug imports/requires
          path.traverse({
            /**
             * Handle require('debug') patterns including:
             * Examples:
             * - const debug = require('debug')
             * - var log = require('debug')('app:log')
             */
            CallExpression(path) {
              if (
                path.get('callee').isIdentifier({name: 'require'}) &&
                path.node.arguments[0]?.value === 'debug'
              ) {
                const parent = path.findParent((p) => p.isVariableDeclarator())
                if (parent) {
                  const binding = path.scope.getBinding(parent.node.id.name)
                  if (binding) debugBindings.add(binding)
                  const pathToRemove = getVariablePathToRemove(parent)
                  pathToRemove && pathsToRemove.add(pathToRemove)
                }
              }
            },

            /**
             * Handle ES6 imports of the debug module
             * All import statements will be removed entirely
             *
             * Examples:
             * - import * as debug from 'debug'
             * - import debug from 'debug'
             * - import { debug } from 'debug'
             * - import { debug as d } from 'debug'
             */
            ImportDeclaration(path) {
              if (path.node.source.value === 'debug') {
                path.node.specifiers.forEach((specifier) => {
                  const binding = path.scope.getBinding(specifier.local.name)
                  if (binding) debugBindings.add(binding)
                })
                pathsToRemove.add(path)
              }
            }
          })

          // Process all debug-related bindings to find and handle their usages
          for (const binding of debugBindings) {
            // For each place this binding is referenced in the code
            for (const refPath of binding.referencePaths) {
              /**
               * Handle property access patterns including:
               * Examples:
               * - debug.enabled (replaced with undefined)
               * - debug.extend('sub') (removed)
               * - const x = debug.extend (removed)
               */
              if (
                refPath.parentPath.isMemberExpression({object: refPath.node})
              ) {
                const memberExp = refPath.parentPath

                if (
                  memberExp.parentPath.isCallExpression({
                    callee: memberExp.node
                  })
                ) {
                  // Method call: debug.enable('ns')
                  // Remove the entire statement containing this call
                  pathsToRemove.add(memberExp.parentPath.parentPath)
                } else if (
                  memberExp.findParent((p) => p.isVariableDeclarator())
                ) {
                  // Assignment: const x = debug.extend
                  const declarator = memberExp.findParent((p) =>
                    p.isVariableDeclarator()
                  )
                  const newBinding = declarator.scope.getBinding(
                    declarator.node.id.name
                  )
                  if (newBinding) debugBindings.add(newBinding)
                  const pathToRemove = getVariablePathToRemove(declarator)
                  pathToRemove && pathsToRemove.add(pathToRemove)
                } else {
                  // Property access: console.log(debug.enabled)
                  memberExp.replaceWith(t.identifier('undefined'))
                }
                continue
              }

              /**
               * Handle direct debug calls including:
               * Examples:
               * - debug('test')
               * - log('message')
               * Both the calls and their containing statements are removed.
               */
              if (refPath.parentPath.isCallExpression({callee: refPath.node})) {
                const callExp = refPath.parentPath
                // If this call is part of a variable declaration, track the new binding
                const declarator = callExp.findParent((p) =>
                  p.isVariableDeclarator()
                )
                if (declarator) {
                  const newBinding = declarator.scope.getBinding(
                    declarator.node.id.name
                  )
                  if (newBinding) debugBindings.add(newBinding)
                  const pathToRemove = getVariablePathToRemove(declarator)
                  pathToRemove && pathsToRemove.add(pathToRemove)
                } else {
                  // Otherwise remove the call statement
                  pathsToRemove.add(callExp.parentPath)
                }
                continue
              }

              /**
               * Handle assignments and aliases:
               * Examples:
               * - const newDebug = debug
               * - let log2 = log
               */
              if (
                refPath.parentPath.isVariableDeclarator({init: refPath.node})
              ) {
                const declarator = refPath.parentPath
                const newBinding = declarator.scope.getBinding(
                  declarator.node.id.name
                )
                if (newBinding) debugBindings.add(newBinding)
                const pathToRemove = getVariablePathToRemove(declarator)
                pathToRemove && pathsToRemove.add(pathToRemove)
              }

              /**
               * Handle destructuring patterns:
               * Examples:
               * - const { extend, enable } = debug
               * - const { debug: d } = require('debug')
               */
              if (
                refPath.parentPath.isVariableDeclarator({init: refPath.node})
              ) {
                const declarator = refPath.parentPath
                // Check if the left-hand side is a destructuring pattern
                if (t.isObjectPattern(declarator.node.id)) {
                  // For each property in the object pattern, add its binding
                  declarator.node.id.properties.forEach((prop) => {
                    const binding = path.scope.getBinding(prop.value.name)
                    if (binding) {
                      debugBindings.add(binding)
                    }
                  })
                } else {
                  // Normal case (non-destructured)
                  const newBinding = declarator.scope.getBinding(
                    declarator.node.id.name
                  )
                  if (newBinding) debugBindings.add(newBinding)
                }
                const pathToRemove = getVariablePathToRemove(declarator)
                pathToRemove && pathsToRemove.add(pathToRemove)
              }
            }
          }

          // Final cleanup: Remove all collected paths in one pass. This is done
          // at the end to avoid removing nodes while we're still traversing
          for (const path of pathsToRemove) {
            if (path.node) path.remove()
          }
        }
      }
    }
  }
}

/* Helper function to properly remove variable declarators.
 *
 * Handle both single and multiple variable declarations:
 * - const log = debug("app:log");
 * - const log = debug("app:log"), other = 123;
 *
 * VariableDeclaration    (const log = debug("app:log"), other = 123)
 *   VariableDeclarator   (log = debug("app:log"))
 *   VariableDeclarator   (other = 123)
 */
function getVariablePathToRemove(declarator) {
  const variableDeclaration = declarator.parentPath

  // If this is the only VariableDeclarator in the VariableDeclaration
  if (variableDeclaration.node.declarations.length === 1) {
    // Remove the entire VariableDeclaration (const/let/var statement)
    return variableDeclaration
  } else {
    // Otherwise just remove this specific VariableDeclarator (a = 1)
    return declarator
  }
}
