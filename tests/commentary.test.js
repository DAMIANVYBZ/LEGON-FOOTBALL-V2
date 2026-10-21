import test from 'node:test';
import assert from 'node:assert/strict';
import { pickLine, resultLine, scoreLine, chooseCommentaryVoice, createCommentary, goalContext } from '../src/commentary.js';
import { playerName, setPlayerNames } from '../src/players.js';

test('score and result lines read like a commentator', () => {
  assert.equal(scoreLine('Commonwealth', 'Sarbah', [0, 0]), 'Still goalless');
  assert.equal(scoreLine('Commonwealth', 'Sarbah', [1, 0]), 'Commonwealth lead 1, nil');
  assert.equal(scoreLine('Commonwealth', 'Sarbah', [1, 2]), 'Sarbah lead 2, 1');
  assert.equal(scoreLine('Commonwealth', 'Sarbah', [2, 2]), '2 all');
  assert.equal(resultLine('Commonwealth', 'Sarbah', [3, 1]), 'Commonwealth win it, 3, 1.');
});

test('lines name the hall, or the username when there is one, and never repeat back to back', () => {
  const last = {};
  const values = { team: 'Commonwealth', venue: 'UG Stadium' };
  const first = pickLine('shot', values, () => 0, last);
  assert.ok(!first.text.includes('{'));
  for (let i = 0; i < 30; i++) assert.ok(!/from Commonwealth!$|path of Commonwealth/.test(pickLine('through', values, Math.random, last).text));
  const second = pickLine('shot', values, () => 0, last);
  assert.notEqual(second.text, first.text);
  assert.ok(pickLine('shot', { ...values, who: 'DamianVybz' }, () => 0, {}).text.includes('DamianVybz'));
  assert.equal(pickLine('goal', values, () => 0, {}).priority, 3);
  assert.equal(pickLine('nonsense', values), null);
});

test('usernames come from the campus game, and a solo player follows the controlled body', () => {
  setPlayerNames({ solo: 'DamianVybz', away: { 3: 'Kwame_10' } });
  assert.equal(playerName(5, 5), 'DamianVybz');
  assert.equal(playerName(4, 5), '');
  assert.equal(playerName(10, 5), 'Kwame_10');
  setPlayerNames({ home: { 2: 'Ama' } });
  assert.equal(playerName(2, 5), 'Ama');
});


test('male voice selection never mistakes Female for Male and handles delayed availability', () => {
 const female={name:'Google UK English Female',lang:'en-GB',default:true};
 const male={name:'Google UK English Male',lang:'en-GB'};
 const ryan={name:'Microsoft Ryan Online (Natural)',lang:'en-GB'};
 assert.equal(chooseCommentaryVoice([female,male]),male);
 assert.equal(chooseCommentaryVoice([female,ryan]),ryan);
 assert.equal(chooseCommentaryVoice([{name:'Microsoft George',lang:'en-GB'},ryan]),ryan);
 assert.equal(chooseCommentaryVoice([]),null);
 assert.equal(chooseCommentaryVoice([female]),female); // no invented installed voice
});

test('goal calls distinguish opening, equalising, taking a lead and still trailing', () => {
 for(const [score,home,expected] of [[[1,0],true,'opener'],[[1,1],false,'equaliser'],[[2,1],true,'lead'],[[3,1],true,'extend'],[[1,3],true,'reply'],[[3,1],false,'reply']]) {
  assert.equal(goalContext(score,home),expected);
  const line=pickLine('goal',{goalMoment:expected,team:'Sarbah',score:scoreLine('Sarbah','Commonwealth',score)},()=>0,{});
  assert.equal(line.priority,3);assert.ok(!line.text.includes('{'));
 }
});

function fakeSpeech(t) {
 const oldSynth=globalThis.speechSynthesis,oldUtterance=globalThis.SpeechSynthesisUtterance;
 const synth={speaking:false,spoken:[],cancels:0,
  getVoices:()=>[{name:'Google UK English Male',lang:'en-GB'}],
  addEventListener(){},removeEventListener(){},
  speak(u){this.spoken.push(u);this.speaking=true;},cancel(){this.cancels++;this.speaking=false;},
  finish(u=this.spoken.at(-1)){this.speaking=false;u.onend?.();}};
 globalThis.speechSynthesis=synth;globalThis.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
 t.after(()=>{globalThis.speechSynthesis=oldSynth;globalThis.SpeechSynthesisUtterance=oldUtterance;});return synth;
}
test('shots interrupt routine chatter; cancelled callbacks cannot derail a goal call', t => {
 const synth=fakeSpeech(t);let time=0;const captions=[];
 const commentary=createCommentary({now:()=>time,onCaption:text=>captions.push(text)});t.after(()=>commentary.dispose());
 commentary.say('build',{team:'Sarbah'});const routine=synth.spoken.at(-1);
 time=100;commentary.say('shot',{team:'Sarbah'});const shot=synth.spoken.at(-1);
 assert.notEqual(shot,routine);assert.equal(synth.cancels,1);
 assert.equal(shot.voice.name,'Google UK English Male');assert.ok(shot.pitch<=1);
 time=150;commentary.say('save',{team:'Commonwealth'});
 time=200;commentary.say('goal',{team:'Sarbah',goalMoment:'opener',score:'Sarbah lead 1, nil'});
 const goal=synth.spoken.at(-1),count=synth.spoken.length;
 routine.onend();shot.onend();assert.equal(synth.spoken.length,count);
 assert.match(goal.text,/GOAL|In it goes/);assert.equal(captions.at(-1),goal.text);
});
test('stale reactions expire and separate shots are not silenced for ten seconds', t => {
 const synth=fakeSpeech(t);let time=0;
 const commentary=createCommentary({now:()=>time});t.after(()=>commentary.dispose());
 commentary.say('shot',{team:'Sarbah'});time=100;commentary.say('save',{team:'Commonwealth'});
 time=2100;synth.finish();assert.equal(synth.spoken.length,1,'stale save should be discarded');
 commentary.say('shot',{team:'Sarbah'});assert.equal(synth.spoken.length,2);
 commentary.setEnabled(false);time=10000;commentary.say('goal',{});assert.equal(synth.spoken.length,2);
});
