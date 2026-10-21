#!/usr/bin/env tsx
/** Offline regression checks for the actual Svelte selection/apply handlers. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function handler(component: string, name: string): string {
  const source = readFileSync(
    new URL(`../src/lib/components/${component}.svelte`, import.meta.url),
    'utf8'
  )
    .split('<script lang="ts">')[1]
    .split('</script>')[0];
  const ast = ts.createSourceFile(
    component,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const statement = ast.statements.find(
    (node) =>
      (ts.isFunctionDeclaration(node) && node.name?.text === name) ||
      (ts.isVariableStatement(node) &&
        node.declarationList.declarations.some((d) => d.name.getText(ast) === name))
  );
  assert.ok(statement, `Missing handler: ${name}`);
  return ts.transpileModule(statement.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ESNext }
  }).outputText;
}

const cascade = vm.createContext({ console });
vm.runInContext(
  `
  let selectionVersion = 0;
  let regionLevels = [{ options: [
    { id: 'A', value: 'A', hasChildren: true },
    { id: 'B', value: 'B', hasChildren: true }
  ], selectedId: '' }];
  const pending = {};
  const fetchRegionOptions = (id) => new Promise((resolve, reject) => pending[id] = { resolve, reject });
  ${handler('RegionCascadeSelect', 'handleRegionSelect')}
`,
  cascade
);
const first = vm.runInContext("handleRegionSelect(0, 'A')", cascade);
assert.equal(vm.runInContext('regionLevels[0].selectedId', cascade), 'A');
const second = vm.runInContext("handleRegionSelect(0, 'B')", cascade);
vm.runInContext("pending.B.resolve([{ id: 'B1', value: 'B1' }])", cascade);
await second;
vm.runInContext("pending.A.resolve([{ id: 'A1', value: 'A1' }])", cascade);
await first;
assert.equal(vm.runInContext('regionLevels[0].selectedId', cascade), 'B');
assert.equal(vm.runInContext('regionLevels[1].options[0].id', cascade), 'B1');
const stale = vm.runInContext("handleRegionSelect(0, 'A')", cascade);
await vm.runInContext("handleRegionSelect(0, '')", cascade);
vm.runInContext("pending.A.resolve([{ id: 'A1', value: 'A1' }])", cascade);
await stale;
assert.equal(vm.runInContext('regionLevels.length', cascade), 1);
assert.equal(vm.runInContext('regionLevels[0].selectedId', cascade), '');

const panel = vm.createContext({});
vm.runInContext(
  `
  let cascadeIds = ['CN', 'CN-310000'];
  let cascadeLabels = ['中国', '上海市'];
  let draft = {};
  let regionChains = {};
  const SHOP_FILTER_MAX_REGIONS = 20;
  const resetCascade = () => { cascadeIds = []; cascadeLabels = []; };
  const $state = { snapshot: structuredClone };
  const supportedState = (state) => state;
  const sanitizeShopFilterState = (state) => state;
  let result;
  const onapply = (state, chains) => result = { state, chains };
  ${handler('ShopFilterPanel', 'addRegion')}
  ${handler('ShopFilterPanel', 'handleApply')}
  handleApply();
`,
  Object.assign(panel, { structuredClone })
);
assert.equal(vm.runInContext('result.state.regions[0]', panel), 'CN-310000');
assert.equal(vm.runInContext("result.chains['CN-310000'][1].name", panel), '上海市');
vm.runInContext("cascadeIds = ['CN', 'CN-310000']; handleApply()", panel);
assert.equal(vm.runInContext('result.state.regions.length', panel), 1);
console.log('Region selection regressions passed (pending Apply, race, clear, labels, duplicate).');
