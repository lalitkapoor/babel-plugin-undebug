import assert from 'node:assert/strict'
import test from 'node:test'
import babel from '@babel/core'
import plugin from './index.js'

/**
 * @param {string} str
 * @returns {string}
 */
function normalizeWhitespace(str) {
  // Only remove line breaks and trim, preserve other whitespace
  return str.trim().replace(/[\r\n]\s*/g, '')
}

/**
 * @param {string} input
 * @param {string} expected
 * @param {string} message
 */
function assertTransform(input, expected, message) {
  const transformed = transform(input)
  assert.equal(
    transformed ? normalizeWhitespace(transformed) : transformed,
    expected ? normalizeWhitespace(expected) : expected,
    message
  )
}

test('babel-plugin-undebug', function () {
  // Test empty file
  assertTransform('', '', 'should not crash on an empty file')

  // Test basic require pattern
  assertTransform(
    `
    var d = require("debug");
    var a = d("a");
    a("b")
    `,
    '',
    'should support requiring debug and making instances later'
  )

  // Test immediate instance creation
  assertTransform(
    `
    var a = require("debug")("a");
    a("b")
    `,
    '',
    'should support make an instance from a debug require'
  )

  // Test multiple requires
  assertTransform(
    `
    var a = require("debug");
    var b = require("debug")("b");
    var c = require("debug")("c");
    a("x")(1);
    b(2);
    c(3)
    `,
    '',
    'should support requiring `debug` several times, in several ways'
  )

  // Test ES module default import
  assertTransform(
    `
    import d from "debug";
    var a = d("a");
    a("b")
    `,
    '',
    'should support importing default debug and making instances later'
  )

  // Test ES module named import
  assertTransform(
    `
    import {debug as d} from "debug";
    var a = d("a");
    a("b")
    `,
    '',
    'should support importing `debug` from debug and making instances later'
  )

  // Test ES module namespace import
  assertTransform(
    `
    import * as d from "debug";
    var a = d("a");
    a("b")
    `,
    '',
    'should support importing `debug` as a namespace and making instances later'
  )

  // Test non-debug require preservation
  assertTransform(
    `
    var a = require("assert");
    assert("a");
    `,
    `
    var a = require("assert");
    assert("a");
    `,
    'should not remove other require calls'
  )

  // Test non-debug import preservation
  assertTransform(
    `
    import assert from "assert";
    assert("a");
    `,
    `
    import assert from "assert";
    assert("a");
    `,
    'should not remove other imports'
  )

  // Test preservation of unrelated calls
  assertTransform(
    `
    a(1);
    b = 1 + 1;
    c()();
    d.e();
    f("g")
    `,
    `
    a(1);
    b = 1 + 1;
    c()();
    d.e();
    f("g");
    `,
    'should not remove other calls'
  )

  // Test destructuring
  assertTransform(
    `
  import debug from 'debug';
  const {extend, enable} = debug;
  const log = extend('sub');
  enable('*');
  `,
    '',
    'should handle destructuring'
  )

  // Test aliased callers
  assertTransform(
    `
    import {debug as d} from "debug";
    var a = d("a");
    var b = a;
    b("c");
    `,
    '',
    'should support aliased callers'
  )

  // Test member property function calls
  assertTransform(
    `
    import {debug as d} from "debug";
    var a = d("a");
    a.log("b");
    `,
    '',
    'should remove member property function calls'
  )

  // Test member property access
  assertTransform(
    `
    import {debug as d} from "debug";
    var a = d("a");
    console.log("is a.enabled?", a.enabled)
    `,
    `
    console.log("is a.enabled?", undefined);
    `,
    'should replace member properties with undefined'
  )

  // Test aliased member property access
  assertTransform(
    `
    import {debug as d} from "debug";
    var a = d("a");
    var b = a;
    console.log("is b.enabled?", b.enabled)
    `,
    `
    console.log("is b.enabled?", undefined);
    `,
    'should replace aliased member properties with undefined'
  )

  // Test aliased member property function calls
  assertTransform(
    `
    import {debug as d} from "debug";
    var a = d("a");
    var b = a.log;
    b("c");
    `,
    '',
    'should remove aliased member property function calls'
  )

  // Test alias with member property
  assertTransform(
    `
    import {debug as d} from "debug";
    var a = d("a");
    var b = a;
    b.log("c");
    `,
    '',
    'should remove alias that uses a member property'
  )

  // Test multiple variable declarations
  assertTransform(
    `
  import {debug as d} from "debug";
  var a = d("a"), other = 123;
  const x = d("x"), y = 456, z = d("z");
  let p = d("p"), q = 789;
  a("b");
  x("test");
  z("foo");
  p("bar");
  console.log(other, y, q);
  `,
    `
  var other = 123;
  const y = 456;
  let q = 789;
  console.log(other, y, q);
  `,
    'should handle multiple variable declarations, removing only debug-related ones'
  )
})

/**
 * @param {string} value Input
 * @returns {string|undefined} Output
 */
function transform(value) {
  const result = babel.transformSync(value, {
    configFile: false,
    plugins: [plugin]
  })
  assert(result, 'expected result')
  return typeof result.code === 'string' ? result.code : undefined
}
