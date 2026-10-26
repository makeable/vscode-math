import * as d3 from 'd3';
import _ from 'lodash';
import * as math from 'mathjs';

// Plain TypeScript. Math View draws it as maths; click a line to see the code.

// Sums and products from reduce pipelines
const total = xs.reduce((s, x) => s + x, 0);
const sumSquares = xs.map(x => x * x).reduce((a, b) => a + b, 0);
const positiveProduct = xs.filter(x => x > 0).reduce((a, b) => a * b, 1);
const weighted = Array.from({ length: n }, (_, i) => w[i] * x[i]).reduce((a, b) => a + b, 0);
const basel = [...Array(n).keys()].map(k => 1 / (k + 1) ** 2).reduce((s, t) => s + t, 0);
const factorial = _.range(1, n + 1).reduce((acc, k) => acc * k, 1);
const peak = xs.reduce((m, x) => Math.max(m, f(x)), -Infinity);

// Quantifiers and accessors
const allPositive = xs.every(x => x > 0);
const hasRoot = grid.some(z => Math.abs(f(z)) < eps);
const revenue = _.sumBy(orders, o => o.price * o.qty);
const meanSquare = d3.mean(xs, x => x ** 2);
const best = _.maxBy(models, m => score(m));

// Fractions, roots and powers
const root = (-b + Math.sqrt(b ** 2 - 4 * a * c)) / (2 * a);
const area = Math.PI * r ** 2;
const distance = Math.hypot(dx, dy);
const bits = Math.log(x) / Math.LN2;

// Linear algebra with mathjs
const normal = math.multiply(math.inv(math.multiply(math.transpose(A), A)), math.transpose(A));
const rotation = math.matrix([[Math.cos(theta), -Math.sin(theta)],
                              [Math.sin(theta), Math.cos(theta)]]);

// Piecewise
const sign = x < 0 ? -1 : x === 0 ? 0 : 1;
const relu = (z: number): number => z > 0 ? z : 0;
