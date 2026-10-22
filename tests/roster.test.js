import test from 'node:test';
import assert from 'node:assert/strict';
import { VENUES } from '../src/venues.js';
import { teamSizeForVenue, formationsForVenue, resolveFormation, fieldPositions, kickoffRoles } from '../src/roster.js';
import { goalKickPosition } from '../src/gameplay.js';
import { playerName, setPlayerNames } from '../src/players.js';

test('all pitches have ten per side except unchanged seven-a-side Presec', () => {
  for (const venue of VENUES) {
    const size=teamSizeForVenue(venue);assert.equal(size,venue.id==='astro'?7:10);
    for(const formation of formationsForVenue(venue))for(const side of [-1,1]){
      const positions=fieldPositions(formation,side,venue.length,venue.width,size);
      assert.equal(positions.length,size);assert.equal(positions.filter(([x,z])=>Math.abs(x)===venue.length*.46&&z===0).length,1);
      assert.equal(new Set(positions.map(p=>p.join(','))).size,size);
      assert.ok(positions.every(([x,z])=>x*side<0&&Math.abs(z)<venue.width/2));
      for(let i=0;i<size;i++)for(let j=i+1;j<size;j++)assert.ok(Math.hypot(positions[i][0]-positions[j][0],positions[i][1]-positions[j][1])>2);
    }
    assert.equal(kickoffRoles(size).length,size-1);
  }
});

test('saved formations translate between team sizes and retain Presec shapes', () => {
  assert.equal(resolveFormation('2–2–2',10),'3–3–3');assert.equal(resolveFormation('4–3–2',7),'3–2–1');
  const original=[[-56*.46,0],[-56*.34,-36*.33],[-56*.34,36*.33],[-56*.19,-36*.33],[-56*.19,36*.33],[-56*.055,-36*.33],[-56*.055,36*.33]];
  assert.deepEqual(fieldPositions('2–2–2',1,56,36,7),original);
});

test('nine outfielders have distinct legal goal-kick outlets and correct keeper name slots', () => {
  for(const venue of VENUES.filter(v=>v.id!=='astro'))for(const teammate of [true,false]){
    const points=Array.from({length:9},(_,i)=>goalKickPosition(i+1,venue,true,teammate,9));
    assert.equal(new Set(points.map(p=>`${p.x},${p.z}`)).size,9);
    assert.ok(points.every(p=>Math.abs(p.x)<venue.length/2&&Math.abs(p.z)<venue.width/2));
  }
  setPlayerNames({home:{0:'Home keeper',9:'Home forward'},away:{0:'Away keeper',9:'Away forward'},solo:''});
  assert.equal(playerName(9,-1,10),'Home forward');assert.equal(playerName(10,-1,10),'Away keeper');assert.equal(playerName(19,-1,10),'Away forward');
  assert.equal(playerName(7,-1,7),'Away keeper');
  setPlayerNames({home:{},away:{},solo:''});
});
