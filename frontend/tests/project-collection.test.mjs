import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterProjectCollection } from '../app/lib/projects/collection.mjs';
const projects = [
  {project_id:'a',name:'Muon detector',description:'실험 조건',tags:['tomography'],status:'active',priority:'normal'},
  {project_id:'b',name:'Detector archive',description:'baseline',tags:['muon'],status:'archived',priority:'high'},
  {project_id:'c',name:'Muon detector',description:'baseline',tags:['tomography'],status:'active',priority:'high'},
];
test('project search combines words across fields regardless of order', () => {
  assert.deepEqual(filterProjectCollection(projects,'tomography detector').map(p=>p.project_id),['a','c']);
  assert.deepEqual(filterProjectCollection(projects,'  조건   MUON　').map(p=>p.project_id),['a']);
  assert.equal(filterProjectCollection(projects,'tomography missing').length,0);
});
test('project search normalizes Unicode width and decomposed Korean', () => {
  assert.equal(filterProjectCollection(projects,'ＭＵＯＮ 실험'.normalize('NFD'))[0],projects[0]);
});
test('search, status and priority are an intersection', () => {
  assert.deepEqual(filterProjectCollection(projects,'detector','active','high'),[projects[2]]);
  assert.deepEqual(filterProjectCollection(projects,'tomography','archived','high'),[]);
});
test('clearing preserves source order, identities, empty input and original data', () => {
  const before=JSON.stringify(projects);
  const result=filterProjectCollection(projects,'　 \n');
  assert.deepEqual(result,projects); assert.notEqual(result,projects);
  result.reverse(); assert.equal(projects[0].project_id,'a');
  assert.equal(JSON.stringify(projects),before); assert.deepEqual(filterProjectCollection([]),[]);
});
test('project UI resets all filters and pagination, restores focus and preserves sort', () => {
  const source=readFileSync(new URL('../app/views/ProjectsView.tsx',import.meta.url),'utf8');
  assert.match(source,/filterProjectCollection\(resource.data, search, statusFilter, priorityFilter\)/);
  assert.match(source,/ref=\{searchRef\} type="search"/);
  assert.match(source,/disabled=\{!search && !statusFilter && !priorityFilter\}/);
  const handler=source.match(/onClick=\{\(\) => \{ setSearch\(""\);[^}]+/)[0];
  for(const setter of ['setStatusFilter("")','setPriorityFilter("")','setOffset(0)','searchRef.current?.focus()']) assert.ok(handler.includes(setter));
  assert.ok(!handler.includes('setSort'));
});
