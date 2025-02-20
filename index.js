/**
 * Plugin to remove `debug` from code.
 *
 * @returns {PluginObj}
 */
export default function ({types: t}) {
  return {
    name: 'remove-debug-imports',
    visitor: {
      Program(path) {
        const debugReferences = new Set()
        const pathsToRemove = new Set()

        path.traverse({
          /**
           * Handle variable declarations including:
           * Examples:
           * - const debug = require('debug')
           * - var log = require('debug')('app:log')
           * - let log = debug('namespace')
           *
           * Tracks the created bindings and marks declarations for removal.
           * All examples above will be removed entirely.
           */
          VariableDeclarator(path) {
            const init = path.get('init')

            // Handle require('debug')
            if (
              init.isCallExpression() &&
              init.get('callee').isIdentifier({name: 'require'}) &&
              init.node.arguments.length > 0 &&
              init.node.arguments[0].value === 'debug'
            ) {
              const binding = path.scope.getBinding(path.node.id.name)
              if (binding) {
                debugReferences.add(binding)
              }
              pathsToRemove.add(path.parentPath)
            }

            // Handle require('debug')('something')
            if (init.isCallExpression()) {
              const callee = init.get('callee')
              if (
                callee.isCallExpression() &&
                callee.get('callee').isIdentifier({name: 'require'}) &&
                callee.node.arguments.length > 0 &&
                callee.node.arguments[0].value === 'debug'
              ) {
                const binding = path.scope.getBinding(path.node.id.name)
                if (binding) {
                  debugReferences.add(binding)
                }
                pathsToRemove.add(path.parentPath)
              }
            }
          },

          /**
           * Handle ES6 imports of the debug module
           * Examples:
           * - import debug from 'debug'
           * - import { debug } from 'debug'
           * - import { debug as d } from 'debug'
           *
           * All import statements will be removed entirely.
           */
          ImportDeclaration(path) {
            if (path.node.source.value === 'debug') {
              path.node.specifiers.forEach((specifier) => {
                const binding = path.scope.getBinding(specifier.local.name)
                if (binding) {
                  debugReferences.add(binding)
                }
              })
              pathsToRemove.add(path)
            }
          }
        })

        // Keep iterating until we've found all debug-related references
        let lastSize = 0
        while (debugReferences.size > lastSize) {
          lastSize = debugReferences.size

          path.traverse({
            /**
             * Handle identifier references to debug or debug-created functions
             * Examples to be removed entirely:
             * - log('message')               // direct call
             * - const newLog = log           // aliasing
             * - const sub = log.extend('sub') // method call assignment
             *
             * Examples where property access is replaced with undefined:
             * - console.log(log.enabled)     // becomes console.log(undefined)
             * - if (log.namespace === 'test') // becomes if (undefined === 'test')
             */
            Identifier(path) {
              // Skip identifiers that are being declared
              if (path.parentPath.isVariableDeclarator({id: path.node})) return

              const binding = path.scope.getBinding(path.node.name)
              if (binding && debugReferences.has(binding)) {
                // If it's used in a call
                // e.g., debug('test'), log('message')
                if (path.parentPath.isCallExpression({callee: path.node})) {
                  pathsToRemove.add(path.parentPath.parentPath)
                }

                // If it's being assigned to another variable (aliased)
                // e.g., const myDebug = debug, const log2 = log
                const parentPath = path.parentPath
                if (parentPath.isVariableDeclarator({init: path.node})) {
                  const newBinding = path.scope.getBinding(
                    parentPath.node.id.name
                  )
                  if (newBinding) {
                    debugReferences.add(newBinding)
                  }
                  pathsToRemove.add(parentPath.parentPath)
                }

                // If it's used as object in a member expression
                // e.g., debug.enable('ns'), log.namespace, debug.extend('sub')
                if (path.parentPath.isMemberExpression({object: path.node})) {
                  const memberExp = path.parentPath

                  // Check if the member expression is part of a variable declaration
                  // e.g., const sub = log.extend, const ns = debug.namespace
                  const isInDeclaration = memberExp.findParent((p) =>
                    p.isVariableDeclarator()
                  )

                  if (
                    memberExp.parentPath.isCallExpression({
                      callee: memberExp.node
                    })
                  ) {
                    // It's a method call (e.g., a.log())
                    pathsToRemove.add(memberExp.parentPath.parentPath)
                  } else if (isInDeclaration) {
                    // It's being assigned to a variable (e.g., var b = a.log)
                    const declarator = isInDeclaration
                    const newBinding = declarator.scope.getBinding(
                      declarator.node.id.name
                    )
                    if (newBinding) {
                      debugReferences.add(newBinding)
                    }
                    pathsToRemove.add(declarator.parentPath)
                  } else {
                    // It's used as a value (e.g., console.log(a.enabled))
                    memberExp.replaceWith(t.identifier('undefined'))
                  }
                }
              }
            },

            /**
             * Handle function calls including:
             * Examples to be removed entirely:
             * - debug('app:log')             // direct debug call
             * - log('message')               // call to debug function
             * - log.extend('sub')('detail')  // chained calls
             * - logger.log('test')           // method call
             *
             * Both the calls and their containing statements are removed.
             */
            CallExpression(path) {
              const callee = path.get('callee')

              // Handle direct calls
              if (callee.isIdentifier()) {
                const binding = path.scope.getBinding(callee.node.name)
                if (binding && debugReferences.has(binding)) {
                  const parent = path.parentPath
                  if (parent.isVariableDeclarator()) {
                    const newBinding = parent.scope.getBinding(
                      parent.node.id.name
                    )
                    if (newBinding) {
                      debugReferences.add(newBinding)
                    }
                    pathsToRemove.add(parent.parentPath)
                  } else {
                    pathsToRemove.add(path.parentPath)
                  }
                }
              }

              // Handle method calls
              if (callee.isMemberExpression()) {
                const object = callee.get('object')
                if (object.isIdentifier()) {
                  const binding = path.scope.getBinding(object.node.name)
                  if (binding && debugReferences.has(binding)) {
                    pathsToRemove.add(path.parentPath)
                  }
                }
              }
            }
          })
        }

        // Remove all collected paths at the end
        for (const path of pathsToRemove) {
          if (path.node) {
            path.remove()
          }
        }
      }
    }
  }
}
