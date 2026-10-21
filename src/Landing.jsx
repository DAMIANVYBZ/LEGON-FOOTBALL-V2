import { publicAsset } from './publicAsset.js';
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { loadAnimation, loadPlayerModel } from './assets.js';
import './landing.css';

const KITS = [
  { shirt: '#e7ebed', shorts: '#18384a', socks: '#4ca4cf', accent: '#64c1e9', turn: -0.12 },
  { shirt: '#ffc20e', shorts: '#125c44', socks: '#125c44', accent: '#ffc20e', turn: 0 },
  { shirt: '#bb2535', shorts: '#16181b', socks: '#bb2535', accent: '#ef5862', turn: 0.12 },
];

function clipFrom(motion) {
  const clip = [...motion.animations].sort((a, b) => b.duration - a.duration || b.tracks.length - a.tracks.length)[0];
  if (!clip) return null;
  const result = clip.clone();
  for (const track of result.tracks) {
    if (!track.name.toLowerCase().includes('hips.position')) continue;
    const x = track.values[0], z = track.values[2];
    for (let i = 0; i < track.values.length; i += 3) {
      track.values[i] = x;
      track.values[i + 2] = z;
    }
  }
  return result;
}

function PlayerStage() {
  const mount = useRef(null);
  const [status, setStatus] = useState('Loading footballers');

  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    let disposed = false;
    let frame = 0;
    const timers = [];
    const clock = new THREE.Clock();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 2.35, 7.5);
    camera.lookAt(0, 1.25, 0);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.75;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight('#e8f9ff', '#1c2925', 2.4));
    const key = new THREE.DirectionalLight('#fff4da', 3.3);
    key.position.set(-3, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -7; key.shadow.camera.right = 7;
    key.shadow.camera.top = 7; key.shadow.camera.bottom = -7;
    key.shadow.bias = -0.0003;
    scene.add(key);
    const rim = new THREE.DirectionalLight('#96e8d6', 2.2);
    rim.position.set(4, 5, -3);
    scene.add(rim);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 16), new THREE.ShadowMaterial({ color: '#132c22', opacity: 0.32 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    floor.receiveShadow = true;
    scene.add(floor);
    const positions = [-1.78, 0, 1.78];
    const pedestals = [];
    positions.forEach((x, i) => {
      const base = new THREE.Group();
      base.position.set(x, 0, i === 1 ? 0.27 : -0.36);
      const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.81, 0.9, 0.1, 56), new THREE.MeshStandardMaterial({ color: '#f6f4e9', roughness: 0.76, metalness: 0.08 }));
      disk.position.y = -0.06;
      disk.receiveShadow = true;
      base.add(disk);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.79, 0.019, 8, 64), new THREE.MeshBasicMaterial({ color: KITS[i].accent }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.005;
      base.add(ring);
      scene.add(base);
      pedestals.push(base);
    });

    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 16), new THREE.MeshStandardMaterial({ color: '#fffdf3', roughness: 0.7 }));
    ball.position.set(0.55, 0.16, 0.8);
    ball.castShadow = true;
    scene.add(ball);
    const keeperBall = ball.clone();
    keeperBall.position.set(2.65, 1.25, 0.45);
    scene.add(keeperBall);

    const mixers = [];
    const players = [];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let sceneTime = 0;

    function resize() {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = width < 530 ? 10.6 : width < 750 ? 8.8 : 7.5;
      camera.updateProjectionMatrix();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    function animate() {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);
      sceneTime += delta;
      ball.position.set(0.55 + Math.sin(sceneTime * 5) * 0.17, 0.15 + Math.abs(Math.sin(sceneTime * 5)) * 0.1, 0.8);
      const keeperFlight = ((sceneTime - 1.4 + 6.2) % 6.2) / 6.2;
      keeperBall.position.set(3.45 - Math.min(keeperFlight * 3.5, 1) * 1.3, 1.65 - Math.min(keeperFlight * 3.5, 1) * 0.36, 0.45);
      if (!document.hidden && !reducedMotion) mixers.forEach(mixer => mixer.update(delta));
      renderer.render(scene, camera);
    }
    animate();

    async function loadPlayers() {
      try {
        // The cached source is shared with the match, so scale a private copy.
        const model = cloneSkeleton(await loadPlayerModel());
        if (disposed) return;
        const height = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y;
        if (!height) throw new Error('Invalid player model');
        model.scale.setScalar(2.14 / height);
        model.updateMatrixWorld(true);
        model.position.y -= new THREE.Box3().setFromObject(model).min.y;
        for (let i = 0; i < 3; i++) {
          const figure = cloneSkeleton(model);
          figure.rotation.y = KITS[i].turn;
          figure.traverse(part => {
            if (!part.isMesh) return;
            part.castShadow = true;
            part.receiveShadow = true;
            const name = part.name.toLowerCase();
            let color;
            if (name.includes('shirt') || name.includes('socks')) color = KITS[i].shirt;
            else if (name.includes('shorts')) color = KITS[i].shorts;
            else if (name.includes('body')) color = '#986f4f';
            else if (name.includes('hair')) color = '#211c1b';
            else if (name.includes('shoes')) color = '#e8e7df';
            if (color) part.material = new THREE.MeshStandardMaterial({ color, roughness: 0.86, metalness: 0.02 });
          });
          figure.visible = false;
          pedestals[i].add(figure);
          const mixer = new THREE.AnimationMixer(figure);
          mixers.push(mixer);
          players.push({ mixer, figure, idle: null });
        }
        const motionFiles = ['soccer-idle', 'scissor-kick', 'dribble', 'goalkeeper-diving-save'];
        const motions = await Promise.allSettled(motionFiles.map(loadAnimation));
        if (disposed) return;
        const clips = motions.map(result => result.status === 'fulfilled' ? clipFrom(result.value) : null);
        const idle = clips[0] || clips.find(Boolean);
        if (idle) players.forEach(({ mixer }, i) => {
          const action = mixer.clipAction(idle);
          action.time = i * 0.65;
          action.play();
          players[i].idle = action;
          mixer.update(0.01);
        });
        players.forEach(player => { player.figure.visible = true; });
        setStatus('');
        if (reducedMotion) return;
        const perform = (index, clip) => {
          const player = players[index];
          if (!clip || !player?.idle) return;
          const action = player.mixer.clipAction(clip);
          action.reset().setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
          player.idle.crossFadeTo(action, 0.25, true);
          action.play();
          const timer = window.setTimeout(() => {
            player.idle.reset().play();
            action.crossFadeTo(player.idle, 0.4, true);
          }, Math.min(4200, Math.max(1200, clip.duration * 1000 + 150)));
          timers.push(timer);
        };
        const schedule = (index, clip, delay, period) => {
          timers.push(window.setTimeout(() => {
            perform(index, clip);
            timers.push(['interval', window.setInterval(() => perform(index, clip), period)]);
          }, delay));
        };
        schedule(0, clips[1], 650, 6200);
        if (clips[2] && players[1]?.idle) {
          const dribbleAction = players[1].mixer.clipAction(clips[2]);
          dribbleAction.setLoop(THREE.LoopRepeat, Infinity);
          players[1].idle.crossFadeTo(dribbleAction, 0.3, true);
          dribbleAction.play();
        }
        schedule(2, clips[3], 1400, 6200);
      } catch {
        if (!disposed) setStatus('');
      }
    }
    loadPlayers();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      timers.forEach(timer => Array.isArray(timer) ? clearInterval(timer[1]) : clearTimeout(timer));
      mixers.forEach(mixer => mixer.stopAllAction());
      scene.traverse(object => {
        if (!object.isMesh) return;
        object.geometry?.dispose();
        if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
        else object.material?.dispose();
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, []);

  return <div className="landing-stage" aria-label="Three animated Legon Football players in campus kits">
    <div className="stage-light stage-light-a"/><div className="stage-light stage-light-b"/>
    <div className="stage-pitch-lines"/><div className="stage-grain"/>
    <div className="stage-canvas" ref={mount}/>
    {status && <span className="stage-loading">{status}<span className="loading-dot"/></span>}
    <div className="stage-caption"><span>01 / 03</span><span>THE CAMPUS XI</span><span>LEGON • GH</span></div>
  </div>;
}

export default function Landing({ enter, explore, quick, venue }) {
  useEffect(() => {
    const onKey = event => {
      if (event.key !== 'Enter' || event.repeat || event.target !== document.body) return;
      enter();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enter]);

  return <div className="landing-page">
    <div className="landing-shell">
      <header className="landing-nav">
        <img src={publicAsset('/images/logo.svg')} alt="Legon Football"/>
        <span className="nav-divider"/>
        <span className="nav-location"><i/> UNIVERSITY OF GHANA <b>·</b> ACCRA</span>
        <div className="nav-actions"><button type="button" onClick={explore}>THE FIELDS</button><button type="button" className="nav-play" onClick={quick}>QUICK MATCH <span>↗</span></button></div>
      </header>

      <main className="landing-hero">
        <section className="landing-copy">
          <div className="landing-kicker"><span className="kicker-line"/> BUILT FOR THE CAMPUS <span className="kicker-index">001 / LEGON</span></div>
          <h1>EVERY<br/>FIELD IS<br/><em>HOME.</em></h1>
          <p className="landing-lead">From Sarbah’s red earth to the bright lights of the UG Stadium. Your halls. Your rivals. Your football.</p>
          {venue && <p className="landing-venue">ARRIVED AT <strong>{venue.name.toUpperCase()}</strong></p>}
          <div className="landing-buttons"><button type="button" className="landing-primary" onClick={enter}><span>ENTER THE GAME</span><b>↗</b></button><button type="button" className="landing-secondary" onClick={quick}>QUICK MATCH <span>→</span></button><button type="button" className="landing-secondary" onClick={explore}>EXPLORE CAMPUS FIELDS <span>→</span></button></div>
          <div className="landing-keyhint"><span>↵</span> PRESS ENTER TO PLAY <i/> EST. IN LEGON</div>
        </section>
        <PlayerStage/>
      </main>

      <footer className="landing-footer"><div className="landing-foot-title">MADE FOR MATCH DAY.</div><div className="landing-foot-detail">7 A SIDE <span>✦</span> CAMPUS VENUES <span>✦</span> YOUR TEAM, YOUR STORY</div><span className="landing-foot-mark">LF / 2026</span></footer>
    </div>
  </div>;
}
