const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const filename = path.join(__dirname, '集群可用度建模分析报告.html');
const html = fs.readFileSync(filename, 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
for (const script of scripts) new vm.Script(script[1]);
const context = vm.createContext({});
vm.runInContext(html.match(/<script id="model-core">([\s\S]*?)<\/script>/)[1], context);
const model = vm.runInContext('Reliability', context);
const f = model.evaluate;
const b = { ...model.base };
const close = (a, z, tolerance = 1e-10) => assert(Math.abs(a - z) < tolerance, `${a} != ${z}`);
close(f(1000, b).mtbf, 300);
close(f(500000, b).mtbf, 0.6);
close(f(10000, b).tor, 0.9568162866625108);
close(f(500000, b).tor, 0.08295935458740508);
close(f(500000, model.target).tor, 0.817202109992147);
const noFailure = { ...b, hbm: 0, gpu: 0, net: 0, other: 0, slowRate: 0 };
close(model.totalFit(b), 1e9 / 300000);
close(model.fitMtbf(1000), 1000000);
close(model.fitMtbf(1000, 10000), 100);
close(model.reduction(1000, 500), .5);
close(model.reduction(1000, 1500), -.5);
assert.equal(model.reduction(0, 100), null);
assert.equal(model.fitMtbf(0), Infinity);
close(1 / f(10000,b).mtbf, model.categories.reduce((sum,{key}) => sum + 1/model.fitMtbf(b[key],10000), 0));
const hbmImproved = { ...b, hbm: b.hbm / 2 };
assert(f(10000,hbmImproved).tor > f(10000,b).tor);
close(f(10000,hbmImproved).slowFactor, f(10000,b).slowFactor);
assert(f(10000,{ ...b, hbm: b.hbm * 2 }).tor < f(10000,b).tor);
assert.equal(f(10000,{ ...noFailure, baselineFit: 0 }).mtbf, Infinity);
assert.equal(f(10000,{ ...noFailure, baselineFit: 0 }).slowFactor, 1);
close(f(500000, noFailure).tor, 7200 / 7210);
close(f(500000, { ...noFailure, save: 0 }).tor, 1);
for (const n of [1000, 10000, 100000, 200000, 500000]) {
  for (const mode of ['global', 'dp']) {
    for (const p of [b, model.target]) {
      const r = f(n, p, mode);
      assert(r.tor >= 0 && r.tor <= r.uptime && r.uptime <= 1);
      close(r.losses.reduce((a, x) => a + x, 0) + r.tor, 1);
      assert(f(n, { ...p, recover: 0 }, mode).tor >= r.tor);
      assert(f(n, { ...p, slowRate: 0 }, mode).tor >= r.tor);
      close(f(n, { ...p, slowRate: 0 }, mode).uptime, r.uptime);
      assert(f(n, { ...p, save: 0 }, mode).tor >= r.tor);
    }
  }
}
const steps = model.stages(b, model.target);
close(f(500000, steps.at(-2).p).tor, f(500000, model.target).tor);
close(f(500000, steps.at(-1).p, 'dp').tor, f(500000, model.target, 'dp').tor);
assert(f(500000, { ...b, interval: 6 }, 'dp').tor < f(500000, b, 'dp').tor);
assert(f(500000, { ...b, interval: 6, save: 0.001 }).tor > f(500000, b).tor);

// Independent renewal simulation: a failed attempt loses all work since checkpoint.
let seed = 173;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) + 0.5) / 4294967296;
const lambda = 500000 / 10000 / (30 * 3600), length = b.interval + b.save;
let elapsed = 0, retained = 0;
for (let i = 0; i < 500000; i++) {
  const time = -Math.log(random()) / lambda;
  if (time >= length) { elapsed += length; retained += b.interval; }
  else elapsed += time + b.detect + b.recover;
}
const observed = retained / elapsed, analytical = f(500000, { ...b, slowRate: 0 }).tor;
const relativeError = Math.abs(observed - analytical) / analytical;
assert(relativeError < 0.025);
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
assert.equal(ids.size, [...html.matchAll(/\bid="([^"]+)"/g)].length, 'Duplicate IDs');
for (const link of html.matchAll(/href="#([^"]+)"/g)) assert(ids.has(link[1]), link[1]);
assert(!/<script[^>]+src=|<link[^>]+href=/i.test(html), 'Report must work offline');
const report = {
  validatedAt: new Date().toISOString(),
  result: 'passed',
  simulation: { attempts: 500000, seed: 173, observed, analytical, relativeError },
  keyScales: [10000, 100000, 200000, 500000].map(n => ({ n, baselineGlobal: f(n, b), improvedGlobal: f(n, model.target), baselineDP: f(n, b, 'dp'), improvedDP: f(n, model.target, 'dp') }))
};
fs.writeFileSync(path.join(__dirname, '数值验证结果.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Numerical, renewal, source-anchor, and offline checks passed.');
console.log(JSON.stringify(report.simulation));
