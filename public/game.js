import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// ─── Intro fade-in: background shows for 4s, then lobby-card fades in over 3s ─
setTimeout(() => {
  document.querySelectorAll('.lobby-card').forEach(el => el.classList.add('visible'));
}, 4000);

// ─── Socket ────────────────────────────────────────────────────────────────────
console.log('[TantrumIsland] game.js loaded v' + Date.now());
const socket = window.io();
window._gameSocket = socket;

// ─── Avatar ───────────────────────────────────────────────────────────────────
let _playerAvatar = null; // emoji string or base64 data URL

const AVATAR_EMOJIS = [
  '😀','😎','🤓','😈','👻','🤖','👽','🦄','🐉','🦊','🐺','🦁','🐯','🐻','🐼','🐸',
  '🦋','🦅','🦉','🦜','🐬','🦈','🐙','🦀','🌊','🔥','⚡','🌈','🌙','☀️','🎭','🏴‍☠️',
  '🧙','🧝','🧛','🧟','👹','👺','🎃','💀','🤡','👾','🎮','🏆','💎','🔮','🎯','🎲',
];

function avatarHtml(avatar, name, isBot, color) {
  if (isBot) return '🤖';
  if (!avatar) return escapeHtml((name || '?')[0].toUpperCase());
  if (avatar.startsWith('data:')) return `<img src="${avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block">`;
  return avatar; // emoji
}

function renderAvatarPreview() {
  const el = document.getElementById('avatarPreview');
  if (!el) return;
  if (!_playerAvatar) {
    el.innerHTML = '<span id="avatarPreviewInner">?</span>';
    return;
  }
  if (_playerAvatar.startsWith('data:')) {
    el.innerHTML = `<img src="${_playerAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block">`;
  } else {
    el.innerHTML = `<span id="avatarPreviewInner" style="font-size:1.65rem">${_playerAvatar}</span>`;
  }
}

function resizeImageToDataURL(file, size, cb) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const ctx = cv.getContext('2d');
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2, sy = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
      cb(cv.toDataURL('image/jpeg', 0.72));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// Load saved avatar + name on page load
try {
  const saved = localStorage.getItem('ti_avatar');
  if (saved) { _playerAvatar = saved; }
  const savedName = localStorage.getItem('ti_playerName');
  if (savedName && document.getElementById('playerName')) {
    document.getElementById('playerName').value = savedName;
  }
} catch(e) {}
// Defer preview render until DOM is ready
window.addEventListener('DOMContentLoaded', () => { renderAvatarPreview(); setupAvatarPicker(); });

function setupAvatarPicker() {
  // ── Upload ─────────────────────────────────────────────────────────────────
  const fileInput = document.getElementById('avatarFileInput');
  document.getElementById('btnAvatarUpload')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    resizeImageToDataURL(file, 128, url => {
      _playerAvatar = url;
      try { localStorage.setItem('ti_avatar', url); } catch(e) {}
      renderAvatarPreview();
    });
    fileInput.value = '';
  });

  // ── Camera ─────────────────────────────────────────────────────────────────
  let _cameraStream = null;
  const cameraModal = document.getElementById('cameraModal');
  document.getElementById('btnAvatarCamera')?.addEventListener('click', async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Camera not available on this device/browser'); return;
    }
    try {
      _cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      document.getElementById('cameraVideo').srcObject = _cameraStream;
      cameraModal.style.display = 'flex';
    } catch(e) { alert('Could not access camera: ' + e.message); }
  });
  document.getElementById('btnCameraCapture')?.addEventListener('click', () => {
    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('cameraCanvas');
    const size = 128;
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const min = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - min) / 2, sy = (video.videoHeight - min) / 2;
    ctx.drawImage(video, sx, sy, min, min, 0, 0, size, size);
    _playerAvatar = canvas.toDataURL('image/jpeg', 0.72);
    try { localStorage.setItem('ti_avatar', _playerAvatar); } catch(e) {}
    renderAvatarPreview();
    _cameraStream?.getTracks().forEach(t => t.stop());
    _cameraStream = null;
    cameraModal.style.display = 'none';
  });
  document.getElementById('btnCameraCancel')?.addEventListener('click', () => {
    _cameraStream?.getTracks().forEach(t => t.stop());
    _cameraStream = null;
    cameraModal.style.display = 'none';
  });

  // ── Emoji ──────────────────────────────────────────────────────────────────
  const emojiModal = document.getElementById('emojiModal');
  const emojiGrid = document.getElementById('emojiGrid');
  if (emojiGrid) {
    AVATAR_EMOJIS.forEach(em => {
      const btn = document.createElement('button');
      btn.className = 'emoji-btn'; btn.textContent = em;
      btn.addEventListener('click', () => {
        _playerAvatar = em;
        try { localStorage.setItem('ti_avatar', em); } catch(e) {}
        renderAvatarPreview();
        emojiModal.style.display = 'none';
      });
      emojiGrid.appendChild(btn);
    });
  }
  document.getElementById('btnAvatarEmoji')?.addEventListener('click', () => {
    emojiModal.style.display = 'flex';
  });
  document.getElementById('btnEmojiClose')?.addEventListener('click', () => {
    emojiModal.style.display = 'none';
  });
  emojiModal?.addEventListener('click', e => { if (e.target === emojiModal) emojiModal.style.display = 'none'; });

  // ── Clear ──────────────────────────────────────────────────────────────────
  document.getElementById('btnAvatarClear')?.addEventListener('click', () => {
    _playerAvatar = null;
    try { localStorage.removeItem('ti_avatar'); } catch(e) {}
    renderAvatarPreview();
  });
}

// ─── State ────────────────────────────────────────────────────────────────────
let myId = null;
let roomId = null;
let gameState = null;
let buildMode = null;
let passiveRoadMarkers   = false; // edge markers shown passively when road is affordable
let passiveVertexMarkers = false; // vertex markers shown passively when settlement is affordable

// ─── Mutable params (must be declared before Three.js setup uses them) ────────
const WATER_PARAMS = {
  waveSpeed: 1.30, waveAmp: 1.30, waveScale: 3.00, foamStr: 0.75, opacity: 0.80,
};
const BOB_PARAMS = { enabled: true, amp: 0.02, speed: 0.70 };
const WATER_SPRITE_PARAMS = { amount: 5.0, size: 0.04, opacity: 1.00 };
const LIGHT_PARAMS = {
  timeOfDay: 0.76, sunIntensity: 2.60, ambIntensity: 0.80,
  fillIntensity: 0.50, exposure: 1.00, fogDensity: 0.018, bloomStr: 0.30, bloomRadius: 0.0,
  saturation: 1.30, brightness: 0.0, contrast: 1.0, hue: 0.0, warmth: 0.03,
};

// Per-type cloud params (used by renderBoard to place clouds over mountain hexes)
const CLOUD_PARAMS = {
  enabled:    1,
  height:    -0.45,
  spread:     0.00,
  scale:      0.35,
  opacity:    0.18,
  speed:      0.20,
  amount:     1.20,
  brightness: 0.66,
};

// Sky appearance params (drive sky shader uniforms)
const SKY_PARAMS = {
  horizonR: 0.43, horizonG: 0.60, horizonB: 0.68,
  zenithR:  0.14, zenithG:  0.31, zenithB:  0.45,
  hazeAmt:  0.24,
  sunSize:  225,
  sunGlow:  0.00,
  cloudHeight:    0.0,
  cloudColorTemp: 1.0,
};




// Bank model params
const BANK_PARAMS = {
  scale:       0.70,
  rotationY:   2.10,
  height:      0.07,
  islandR:     1.10,
  islandH:     0.29,
  posX:       -2.00,
  posZ:        0.20,
  posY:       -0.20,
};

// Robber anim/material params
const LAVA_PARAMS = {
  riverEnabled:   1.0,
  riverRotation:  1.24,
  riverTilt:      0.23,
  riverX:        -0.08,
  riverY:        -0.34,
  riverZ:         0.24,
  riverScale:     1.05,
  ballEnabled:    1.0,
  ballX:         -0.14,
  ballY:         -0.31,
  ballZ:          0.05,
  ballScale:      2.95,
  ballScaleY:     0.30,
  steamAmount:    6.0,
  steamGravity:  -0.65,
  steamOpacity:   0.40,
  steamSize:      0.25,
};

// Eruption state — lava appears on one random mountain tile for 2 min, every ~10 min
const _lavaEruption = {
  activeTileId: null,   // hex.id currently erupting (null = none)
  elapsed:      0,      // seconds since eruption started
  duration:     120,    // seconds eruption lasts
  nextIn:       Math.random() * 120 + 480, // first eruption 8-10 min in
};

function _startLavaEruption(hexes) {
  const mtns = (hexes ?? gameState?.board?.hexes ?? []).filter(h => h.type === 'mountains');
  if (!mtns.length) return;
  const hex = mtns[Math.floor(Math.random() * mtns.length)];
  _lavaEruption.activeTileId = hex.id;
  _lavaEruption.elapsed = 0;
  buildLava(hexes ?? gameState?.board?.hexes);
}

function _stopLavaEruption(hexes) {
  _lavaEruption.activeTileId = null;
  // Clear lava meshes
  if (boardGroup?.userData?.lavaMeshes) {
    boardGroup.userData.lavaMeshes.forEach(m => {
      boardGroup.remove(m);
      m.geometry?.dispose();
      if (Array.isArray(m.material)) m.material.forEach(x => x.dispose());
      else m.material?.dispose();
    });
    boardGroup.userData.lavaMeshes = [];
    boardGroup.userData.lavaSteamOrigins = [];
  }
  // Clear in-flight steam
  for (let i = LAVA_STEAM.length - 1; i >= 0; i--) {
    scene.remove(LAVA_STEAM[i].sprite);
    LAVA_STEAM[i].sprite.material.dispose();
  }
  LAVA_STEAM.length = 0;
  // Schedule next eruption: 8–12 minutes
  _lavaEruption.nextIn = Math.random() * 240 + 480;
}

const LAVA_STEAM = [];   // { pos:{x,y,z}, vel:{x,y,z}, t, life, mat }

// Soft circle texture for round steam particles
const _steamCircleTex = (() => {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();

const ROBBER_PARAMS = {
  animSpeed:  0.75,
  scale:      0.50,
  emissive:   0.0,
  roughness:  0.94,
  metalness: -1.0,
  animCycle:  21.0,  // seconds between idle animation cycles
};

// ─── Three.js setup ───────────────────────────────────────────────────────────
const canvas = document.getElementById('c');
const _isMobile = window.innerWidth <= 768;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !_isMobile, powerPreference: 'high-performance' });
renderer.setPixelRatio(_isMobile ? Math.min(window.devicePixelRatio, 1) : Math.min(window.devicePixelRatio, 2));
const MAX_ANISOTROPY = renderer.capabilities.getMaxAnisotropy();
renderer.shadowMap.enabled = !_isMobile;
renderer.shadowMap.type = THREE.BasicShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = LIGHT_PARAMS.exposure * 0.38;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// Environment (soft room lighting for PBR reflections)
const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();
const roomEnv = new RoomEnvironment(renderer);
const envMap = pmrem.fromScene(roomEnv).texture;

const scene = new THREE.Scene();
scene.environment = envMap;
scene.background = new THREE.Color(0xa8c8d8);
scene.fog = new THREE.FogExp2(0xb8c8c0, LIGHT_PARAMS.fogDensity);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 80);
camera.position.set(0, 13, 11);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 4;
controls.maxDistance = 22;
controls.maxPolarAngle = Math.PI / 2.15;
controls.target.set(0, 0, 0);

// ── Lighting — tropical midday ──
const ambient = new THREE.AmbientLight(0xc8d8c0, LIGHT_PARAMS.ambIntensity);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffe8c0, LIGHT_PARAMS.sunIntensity);
sun.position.set(8, 20, 6);
sun.castShadow = !_isMobile;
sun.shadow.mapSize.set(_isMobile ? 512 : 1024, _isMobile ? 512 : 1024);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 60;
sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
sun.shadow.camera.top  =  16; sun.shadow.camera.bottom = -16;
sun.shadow.bias = -0.0005;
scene.add(sun);

// Sky bounce — soft blue fill from above
const fill = new THREE.DirectionalLight(0x88b8a8, LIGHT_PARAMS.fillIntensity);
fill.position.set(-6, 8, -6);
scene.add(fill);

// Subtle warm ground bounce
const ground = new THREE.DirectionalLight(0xf0e0a0, 0.15);
ground.position.set(0, -4, 0);
scene.add(ground);

// ── Post-processing ──
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

// One outline pass per player color
const _PIECE_COLORS = ['#e74c3c', '#3498db', '#ffffff', '#2ecc71'];
const _outlinePasses = _PIECE_COLORS.map(col => {
  const pass = new OutlinePass(
    new THREE.Vector2(window.innerWidth, window.innerHeight), scene, camera
  );
  pass.edgeStrength   = 6.0;
  pass.edgeGlow       = 0.0; // no bleed — closest building always wins
  pass.edgeThickness  = 1.5;
  pass.pulsePeriod    = 0;
  pass.visibleEdgeColor.set(col);
  pass.hiddenEdgeColor.set('#000000');
  pass.selectedObjects = [];
  if (_isMobile) pass.enabled = false; // outlines too expensive on mobile
  composer.addPass(pass);
  return { pass, color: col };
});

// Single outline pass for all 3D port icon objects (white glow)
const _PORT_OUTLINE_COLORS = {
  sheep:    '#7edc5a',
  brick:    '#e8732a',
  ore:      '#9baab8',
  wood:     '#4a2d0e',
  wheat:    '#f5c842',
  any:      '#ffffff',
};
const _portOutlinePass = new OutlinePass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), scene, camera
);
_portOutlinePass.edgeStrength  = 10.0;
_portOutlinePass.edgeGlow      = 0.8;
_portOutlinePass.edgeThickness = 2.5;
_portOutlinePass.pulsePeriod   = 0;
_portOutlinePass.visibleEdgeColor.set('#ffffff');
_portOutlinePass.hiddenEdgeColor.set('#ffffff');
_portOutlinePass.selectedObjects = [];
if (_isMobile) _portOutlinePass.enabled = false;
composer.addPass(_portOutlinePass);
// Keep _portOutlinePasses as a shim so existing callers work unchanged
const _portOutlinePasses = [{ pass: _portOutlinePass, type: '_all' }];

const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), LIGHT_PARAMS.bloomStr, 0.5, 0.85);
if (_isMobile) bloom.enabled = false;
composer.addPass(bloom);
composer.addPass(new OutputPass());

const saturationPass = new ShaderPass({
  uniforms: {
    tDiffuse:    { value: null },
    uSaturation: { value: LIGHT_PARAMS.saturation },
    uBrightness: { value: LIGHT_PARAMS.brightness },
    uContrast:   { value: LIGHT_PARAMS.contrast },
    uHue:        { value: LIGHT_PARAMS.hue },
    uWarmth:     { value: LIGHT_PARAMS.warmth },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uSaturation, uBrightness, uContrast, uHue, uWarmth;
    varying vec2 vUv;
    vec3 rgb2hsl(vec3 c){
      float mx=max(c.r,max(c.g,c.b)), mn=min(c.r,min(c.g,c.b)), d=mx-mn;
      float h=0.,s=0.,l=(mx+mn)*.5;
      if(d>0.){
        s=d/(1.-abs(2.*l-1.));
        if(mx==c.r) h=mod((c.g-c.b)/d,6.);
        else if(mx==c.g) h=(c.b-c.r)/d+2.;
        else h=(c.r-c.g)/d+4.;
        h/=6.;
      }
      return vec3(h,s,l);
    }
    float hue2rgb(float p,float q,float t){
      if(t<0.)t+=1.; if(t>1.)t-=1.;
      if(t<1./6.) return p+(q-p)*6.*t;
      if(t<1./2.) return q;
      if(t<2./3.) return p+(q-p)*(2./3.-t)*6.;
      return p;
    }
    vec3 hsl2rgb(vec3 c){
      if(c.y==0.) return vec3(c.z);
      float q=c.z<.5?c.z*(1.+c.y):c.z+c.y-c.z*c.y, p=2.*c.z-q;
      return vec3(hue2rgb(p,q,c.x+1./3.),hue2rgb(p,q,c.x),hue2rgb(p,q,c.x-1./3.));
    }
    void main(){
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = tex.rgb;
      // Saturation
      float luma = dot(c, vec3(0.299,0.587,0.114));
      c = mix(vec3(luma), c, uSaturation);
      // Hue shift
      if(uHue != 0.){
        vec3 hsl = rgb2hsl(c);
        hsl.x = fract(hsl.x + uHue);
        c = hsl2rgb(hsl);
      }
      // Warmth: push red up / blue down (or vice versa)
      c.r = clamp(c.r + uWarmth, 0., 1.);
      c.b = clamp(c.b - uWarmth, 0., 1.);
      // Brightness + contrast
      c = clamp((c + uBrightness - 0.5) * uContrast + 0.5, 0., 1.);
      gl_FragColor = vec4(c, tex.a);
    }`,
});
composer.addPass(saturationPass);

// ── Sky dome ──
{
  const skyGeo = new THREE.SphereGeometry(48, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime:     { value: 0 },
      uHorizon:  { value: new THREE.Color(SKY_PARAMS.horizonR, SKY_PARAMS.horizonG, SKY_PARAMS.horizonB) },
      uZenith:   { value: new THREE.Color(SKY_PARAMS.zenithR,  SKY_PARAMS.zenithG,  SKY_PARAMS.zenithB) },
      uHazeAmt:  { value: SKY_PARAMS.hazeAmt },
      uSunSize:  { value: SKY_PARAMS.sunSize },
      uSunGlow:  { value: SKY_PARAMS.sunGlow },
      uSunDir:   { value: new THREE.Vector3(8, 20, 6).normalize() },
    },
    vertexShader: `varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vPos;
      uniform float uTime;
      uniform vec3  uHorizon;
      uniform vec3  uZenith;
      uniform float uHazeAmt;
      uniform float uSunSize;
      uniform float uSunGlow;
      uniform vec3  uSunDir;
      void main(){
        float h = clamp(vPos.y / 30.0, 0.0, 1.0);
        vec3 mid = mix(uHorizon, uZenith, 0.45);
        vec3 sky = mix(uHorizon, mid,    smoothstep(0.0, 0.35, h));
        sky       = mix(sky,    uZenith, smoothstep(0.28, 0.85, h));
        float haze = 1.0 - smoothstep(0.0, 0.09, h);
        sky = mix(sky, vec3(0.95, 0.97, 0.94), haze * uHazeAmt);
        vec3 rayDir = normalize(vPos);
        float sun = max(0.0, dot(rayDir, uSunDir));
        sky += vec3(1.0, 0.97, 0.82) * pow(sun, uSunSize) * 2.5;
        sky += vec3(1.0, 0.92, 0.72) * pow(sun, 18.0) * uSunGlow;
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyMesh);
  scene.userData.skyMat = skyMat;
}

// ── Clouds ──
{
  function makeCloud(x, y, z, scale) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, transparent: true, opacity: 0.82, envMapIntensity: 0, emissive: 0xffffff, emissiveIntensity: 0.05 });
    [[0,0,0,1],[1.1,0.1,0.2,0.72],[-1.0,0,-0.2,0.68],[0.4,0.4,0,0.6],[-0.3,0.3,0.3,0.5]].forEach(([bx,by,bz,bs])=>{
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.9*bs, 7, 5), mat.clone());
      m.position.set(bx, by, bz); m.scale.set(1.6, 0.9, 1.0); g.add(m);
    });
    g.position.set(x, y, z); g.scale.setScalar(scale);
    return g;
  }
  const cloudGroup = new THREE.Group();
  [ [14,10,-18,2.2],[-12,12,-20,1.8],[22,11,-14,1.5],[-20,9,-16,2.0],
    [8,13,-25,1.6],[-5,11,-22,2.4],[18,9,-10,1.3],[-16,12,-12,1.9] ].forEach(([x,y,z,s])=>{
    cloudGroup.add(makeCloud(x, y, z, s));
  });
  scene.add(cloudGroup);
  scene.userData.cloudGroup = cloudGroup;
}

// ── Groups ──
const boardGroup  = new THREE.Group();
const buildGroup  = new THREE.Group();
const robberGroup = new THREE.Group();  // separate so clearGroup(buildGroup) doesn't kill it
robberGroup.renderOrder = 1;  // always render robber after transparent ocean
const markerGroup = new THREE.Group();
scene.add(boardGroup, buildGroup, robberGroup, markerGroup);

// Tile intro fly-in + independent bobbing
let _introDone = false;
let _modelsReady = false;
let _pendingIntroHexes = null;
// Page must be fully loaded before the intro can fire
let _pageReady = document.readyState === 'complete';
if (!_pageReady) {
  window.addEventListener('load', () => {
    _pageReady = true;
    // If intro was waiting on page load, fire it now (models and font must also be ready)
    if (_pendingIntroHexes && _modelsReady && _fontReady) {
      const hexes = _pendingIntroHexes;
      _pendingIntroHexes = null;
      startTileIntro(hexes);
    }
  }, { once: true });
}
const cameraIntro = { active: false, t: 0, duration: 5.0 };
let _markerGlowTex = null;
function markerGlowTex() {
  if (_markerGlowTex) return _markerGlowTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  grad.addColorStop(0,    'rgba(255,220,80,1)');
  grad.addColorStop(0.30, 'rgba(255,180,30,0.75)');
  grad.addColorStop(0.65, 'rgba(255,130,0,0.3)');
  grad.addColorStop(1,    'rgba(255,100,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  _markerGlowTex = new THREE.CanvasTexture(canvas);
  return _markerGlowTex;
}
const tileBobPhases = new Map(); // hexId → float phase offset
const waterRings    = [];        // { mesh, t, duration }
const tileIntro = { active: false, t: 0, duration: 4.0, hexOffsets: new Map(), hexes: [], hexCollOff: new Map(), shakeTriggered: false };

// Spiral QR coordinates for token fall order (matches server placement)
const SPIRAL_QR_OUTER = [[0,-2],[1,-2],[2,-2],[2,-1],[2,0],[1,1],[0,2],[-1,2],[-2,2],[-2,1],[-2,0],[-1,-1]];
const SPIRAL_QR_INNER = [[0,-1],[1,-1],[1,0],[0,1],[-1,1],[-1,0]];

const tokenIntro = {
  active: false, t: 0,
  scheduled: [],  // { hexId, startT, tokenMeshes, baseYs, tileMeshes, landed }
  landings: [],   // { tileMeshes, baseYs, t }
  done: false,
};
const robberDropIntro = { active: false, t: 0, duration: 0.7, targetY: 0 };
const debrisParticles = []; // { mesh, vx, vy, vz, t, lifetime }
let _robberVoEnabled = false;
let _robberVoPlaying = false;
let _robberVoTimer = null;
let _robberVoAudio = null; // current playing Audio element for live volume updates
let VO_FILES = [
  'Ej hekje leire.mp3','e det mulig.mp3','ej hekje kønn.mp3','ej vil ha leire.mp3',
  'live ville aldri lagt røvern der.mp3','sett han der du.mp3','kor dum gjeng det an å bli.mp3',
  'du kan ikkje meine ditta.mp3','ej flira.mp3','no begynne du å bli farlig.mp3',
  'jaujau.mp3','jaja gg\'s.mp3','hallo gjeng an å bruke haude.mp3','embargo.mp3',
];
// Load full list from server (includes all newly added files)
fetch('/api/voice-files').then(r => r.json()).then(files => {
  if (files && files.length > 0) VO_FILES = files;
}).catch(() => {});

// Drop animations: pieces falling from sky onto the board
const dropAnims = []; // { mesh, targetY, t, onLand }
const sheepList  = []; // { mesh, cx, cz, tx, tz, angle, speed, bobT, bobSpeed }
const camelList  = []; // same structure as sheepList
const DROP_HEIGHT = 5.0;
const DROP_DURATION = 0.45; // seconds

// Dust particles after landing
const dustParticles = []; // { mesh, vx, vy, vz, t, duration }
// Hex tile shake anims
const hexShakes = []; // { meshes, t, duration, amp }
// Number token wiggle after dice roll
const tokenWiggles  = []; // { mesh, baseRY, t, duration }
const tokenPulses   = []; // { mesh, origEmissive, t, duration }
const sheepWiggles  = []; // { sheep, t, duration }
let _canAffordCity    = false; // set in updateUI, used in animate loop
let _canAffordRoad    = false;
let _canAffordSettle  = false;
let _mySettlements    = []; // cached list of player's own settlement meshes for pulse
let _edgeMarkerMeshes = []; // cached list of edge marker meshes for pulse
const dustGroup = new THREE.Group();
scene.add(dustGroup);

function spawnDust(x, y, z) {
  const count = 90;
  for (let i = 0; i < count; i++) {
    const geo = new THREE.SphereGeometry(0.025 + Math.random() * 0.035, 4, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xc8a97a, transparent: true, opacity: 0.85 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    dustGroup.add(m);
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.8 + Math.random() * 1.4;
    dustParticles.push({
      mesh: m,
      vx: Math.cos(angle) * speed,
      vy: 1.2 + Math.random() * 1.8,
      vz: Math.sin(angle) * speed,
      t: 0,
      duration: 0.4 + Math.random() * 0.25,
    });
  }
}

function wiggleTokens(hexIds) {
  boardGroup.children.forEach(child => {
    if (child.userData.tokenHexId !== undefined && hexIds.includes(child.userData.tokenHexId)) {
      tokenWiggles.push({
        mesh: child,
        baseRY: child.rotation.y,
        t: 0,
        duration: SCENE_PARAMS.tokenWiggleDur,
      });
    }
  });
}

function pulseTokensRed(hexIds) {
  boardGroup.children.forEach(child => {
    if (child.userData.tokenHexId === undefined || !hexIds.includes(child.userData.tokenHexId)) return;
    const mat = child.material;
    if (!mat) return;
    const origE = mat.emissive ? mat.emissive.clone() : new THREE.Color(0x000000);
    const origEI = mat.emissiveIntensity ?? 0;
    mat.emissive = new THREE.Color(0xff0000);
    tokenPulses.push({ mesh: child, origEmissive: origE, origEmissiveIntensity: origEI, t: 0, duration: 4.0 });
  });
}

function wiggleSheepNear(ix, iz, radius) {
  let anyAffected = false;
  sheepList.forEach(s => {
    const dx = s.mesh.position.x - ix;
    const dz = s.mesh.position.z - iz;
    if (Math.sqrt(dx*dx + dz*dz) <= radius) {
      // Fall direction: away from impact
      const fallAngle = Math.atan2(s.mesh.position.z - iz, s.mesh.position.x - ix);
      // Remove any existing wiggle on this sheep so baseRX/baseRZ are always 0 (upright)
      const existingIdx = sheepWiggles.findIndex(w => w.sheep === s);
      if (existingIdx !== -1) sheepWiggles.splice(existingIdx, 1);
      sheepWiggles.push({
        sheep: s,
        baseY: s.surfaceY + SCENE_PARAMS.sheepY,
        baseRX: 0,
        baseRZ: 0,
        fallAngle,
        t: 0,
        duration: 3.5, // total: fall + lie + get up
      });
      anyAffected = true;
    }
  });
  if (anyAffected) {
    const now = Date.now();
    if (!wiggleSheepNear._lastPlayed || now - wiggleSheepNear._lastPlayed > 5000) {
      wiggleSheepNear._lastPlayed = now;
      const sv = new Audio('sound effects/sheep.mp3');
      sv.volume = Math.min(sfxVol() * 0.15, 0.1);
      sv.play().catch(() => {});
    }
  }
}

function shakeHexes(hexIds, impactX, impactZ, ampScale) {
  hexIds.forEach(hid => {
    const meshes = [];
    boardGroup.children.forEach(child => {
      if (child.userData.hexId === hid) meshes.push(child);
    });
    if (!meshes.length) return;
    meshes.forEach(m => {
      m.userData._shakeBaseY  = m.position.y;
      m.userData._shakeBaseRX = m.rotation.x;
      m.userData._shakeBaseRZ = m.rotation.z;
      // Direction from hex center to impact point (normalized)
      const dx = (impactX ?? m.position.x) - m.position.x;
      const dz = (impactZ ?? m.position.z) - m.position.z;
      const len = Math.sqrt(dx*dx + dz*dz) || 1;
      m.userData._shakeNX = dx / len;
      m.userData._shakeNZ = dz / len;
    });
    const s = ampScale ?? 1;
    hexShakes.push({ meshes, t: 0, duration: 0.5, amp: 0.06 * s, rotAmp: 0.18 * s });
  });
}

// Robber movement animation
let robberLastHexId = null;
const robberMove = {
  active: false,
  startX: 0, startZ: 0,
  endX: 0, endZ: 0, endY: 0,
  t: 0, duration: 1.6,
};

// ── Robber animation state ──
const MOVING_CLIPS = ['Walking', 'Running', 'Excited_Walk_M', 'Crawl_and_Look_Back', 'Casual_Walk', 'Male_Head_Down_Charge'];

const robberAnim = {
  mesh: null,
  mixer: null,
  actions: {},          // clip name → AnimationAction
  currentAction: null,
  baseY: 0,
  active: false,
  lastActive: null,     // track state changes to trigger crossfade
  cycleTimer: 0,        // counts seconds; switches idle anim when it hits cycleInterval
  cycleInterval: 14,    // seconds between idle anim cycles (longer idle pauses)
};
let clock = new THREE.Clock();

// ─── 3D Dice ──────────────────────────────────────────────────────────────────
function makePipTexture(n) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  // Silver face gradient
  const bg = ctx.createRadialGradient(48,40,4, 64,64,60);
  bg.addColorStop(0,   '#ffffff');
  bg.addColorStop(0.45,'#c8c8d0');
  bg.addColorStop(1,   '#606068');
  ctx.fillStyle = bg;
  ctx.roundRect(4,4,120,120,14); ctx.fill();
  // Rim
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 3;
  ctx.roundRect(6,6,116,116,12); ctx.stroke();
  ctx.strokeStyle = 'rgba(40,40,50,0.4)'; ctx.lineWidth = 1.5;
  ctx.roundRect(10,10,108,108,10); ctx.stroke();
  // Dark pips
  ctx.fillStyle = '#1a1a22';
  const pips = {
    1:[[64,64]],
    2:[[38,38],[90,90]],
    3:[[38,38],[64,64],[90,90]],
    4:[[38,38],[90,38],[38,90],[90,90]],
    5:[[38,38],[90,38],[64,64],[38,90],[90,90]],
    6:[[38,32],[90,32],[38,64],[90,64],[38,96],[90,96]],
  }[n] || [];
  pips.forEach(([px,py]) => { ctx.beginPath(); ctx.arc(px,py,10,0,Math.PI*2); ctx.fill(); });
  return new THREE.CanvasTexture(c);
}

// Face order for BoxGeometry: +x,-x,+y,-y,+z,-z  → values 3,4,1,6,2,5
const DIE_FACE_VALS = [3,4,1,6,2,5];
// Euler to put face N on top (+y)
const DIE_TOP_ROT = {
  1: new THREE.Euler(0,0,0),
  6: new THREE.Euler(Math.PI,0,0),
  2: new THREE.Euler(-Math.PI/2,0,0),
  5: new THREE.Euler(Math.PI/2,0,0),
  3: new THREE.Euler(0,0,-Math.PI/2),
  4: new THREE.Euler(0,0,Math.PI/2),
};

function makeDieMesh() {
  const mats = DIE_FACE_VALS.map(n => new THREE.MeshStandardMaterial({ map: makePipTexture(n), color:0xd0d0d8, roughness:0.18, metalness:0.92, envMapIntensity:2.0 }));
  const geo = new THREE.BoxGeometry(0.28, 0.28, 0.28);  // 50% smaller
  const m = new THREE.Mesh(geo, mats);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

const diceGroup = new THREE.Group();
scene.add(diceGroup);
const die1 = makeDieMesh(); const die2 = makeDieMesh();
diceGroup.add(die1, die2);
diceGroup.visible = false;

// diceAnim.settled = true once the roll is done (dice stay on board until next roll)
const diceAnim = { active:false, settled:false, t:0, result:[1,1], duration:1.8, settleDur:0.6 };
let prevDiceSum = null;

function showDiceResult(d1, d2) {
  const sum = d1 + d2;
  const overlay = document.getElementById('diceOverlay');
  const numEl   = document.getElementById('dicePopNum');
  const subEl   = document.getElementById('dicePopSub');
  numEl.textContent = sum;
  subEl.textContent = `${d1} + ${d2}`;
  overlay.style.display = 'flex';
  clearTimeout(overlay._hideTimer);
  overlay._hideTimer = setTimeout(() => { overlay.style.display = 'none'; }, 3500);
}

const _waterIntroSound = new Audio('sound effects/water.mp3');
const _diceSound       = new Audio('sound effects/Dice.aac');
const _vikingHorn      = new Audio('sound effects/Viking Horn.aac');
const _laughingSound   = new Audio('sound effects/laughing.aac');
const _tickSound       = new Audio('sound effects/Timer Clock Click Ticking .aac');
const _logoutSound     = new Audio('sound effects/Log Out Operating System .aac');
const _btnClickSound   = new Audio('sound effects/Interface Button Click.aac');
const _gameStartSound  = new Audio('sound effects/Epic Stock Media - Vibrant Game - Positive Achievement.aac');
_tickSound.loop = true;

let _autoRollTimeout = null;
let _autoRollRafId   = null;
let _autoRollStart   = null;
let _rollPending     = false; // true after emitting rollDice, until server confirms
const AUTO_ROLL_SEC  = 5;

function startAutoRoll() {
  stopAutoRoll();
  if (_tickSound.paused) {
    _tickSound.currentTime = 0;
    _tickSound.volume = sfxVol();
    _tickSound.play().catch(() => {});
  }
  _autoRollStart = performance.now();
  const bar  = document.getElementById('autoRollBar');
  const fill = document.getElementById('autoRollFill');
  if (bar) bar.style.display = 'block';
  function tick() {
    const elapsed = (performance.now() - _autoRollStart) / 1000;
    const frac = Math.max(0, 1 - elapsed / AUTO_ROLL_SEC);
    if (fill) fill.style.width = (frac * 100) + '%';
    if (frac > 0) { _autoRollRafId = requestAnimationFrame(tick); }
  }
  _autoRollRafId = requestAnimationFrame(tick);
  _autoRollTimeout = setTimeout(() => {
    stopAutoRoll();
    _rollPending = true;
    socket.emit('rollDice'); addTimerBonus(15);
  }, AUTO_ROLL_SEC * 1000);
}

function stopAutoRoll() {
  _tickSound.pause();
  if (_autoRollTimeout) { clearTimeout(_autoRollTimeout); _autoRollTimeout = null; }
  if (_autoRollRafId)   { cancelAnimationFrame(_autoRollRafId); _autoRollRafId = null; }
  _autoRollStart = null;
  const bar = document.getElementById('autoRollBar');
  if (bar) bar.style.display = 'none';
}

// Centralised audio volume controls (set by the Audio settings panel)
const AUDIO = {
  sfxVolume: 0.5,   sfxMuted: false,
  voVolume:  0.20,  voMuted:  false,
  vcVolume:  1.0,   vcMuted:  false,
  // music volume + muted live in the music IIFE below and are wired via IDs
};
function sfxVol() { return AUDIO.sfxMuted ? 0 : AUDIO.sfxVolume; }
function voVol()  { return AUDIO.voMuted  ? 0 : AUDIO.voVolume;  }
function applyAudioParams() {
  _diceSound.volume      = sfxVol();
  _vikingHorn.volume     = sfxVol();
  _laughingSound.volume  = sfxVol();
  _tickSound.volume      = sfxVol();
  _logoutSound.volume    = sfxVol();
  _btnClickSound.volume  = sfxVol();
  _gameStartSound.volume = sfxVol();
}
function applyVcVolume() {
  const vol = AUDIO.vcMuted ? 0 : AUDIO.vcVolume;
  if (typeof voiceChat !== 'undefined') {
    Object.values(voiceChat.peers).forEach(p => { if (p.audio) p.audio.volume = vol; });
  }
}

function triggerDiceRoll(d1, d2) {
  _diceSound.currentTime = 0;
  _diceSound.volume = sfxVol();
  _diceSound.play().catch(() => {});
  diceAnim.active = true; diceAnim.settled = false; diceAnim.t = 0; diceAnim.result = [d1, d2];
  diceGroup.visible = true;
  // Throw from high above the board — full tumble during fall
  die1.position.set(-0.5, 5.5, 0.2);
  die2.position.set( 0.5, 6.2, 0.0);
  // Random initial tumble rotation on all axes
  die1.rotation.set(Math.random()*Math.PI*2, Math.random()*Math.PI*2, Math.random()*Math.PI*2);
  die2.rotation.set(Math.random()*Math.PI*2, Math.random()*Math.PI*2, Math.random()*Math.PI*2);
  // Store per-die angular velocities for physics simulation
  diceAnim.av1 = new THREE.Vector3(
    (Math.random()-0.5)*22, (Math.random()-0.5)*18, (Math.random()-0.5)*20
  );
  diceAnim.av2 = new THREE.Vector3(
    (Math.random()-0.5)*20, (Math.random()-0.5)*22, (Math.random()-0.5)*18
  );
}

function updateDiceAnim(delta) {
  if (!diceAnim.active) return;
  diceAnim.t += delta;

  const restY = tileTopY('desert') + 0.14;
  const startY1 = 5.5, startY2 = 6.2;

  if (diceAnim.t < diceAnim.duration) {
    const p = diceAnim.t / diceAnim.duration;
    // Simulated gravity drop with multi-bounce
    const gravY1 = startY1 + (-9.0 * diceAnim.t * diceAnim.t * 0.5);
    const gravY2 = startY2 + (-9.0 * diceAnim.t * diceAnim.t * 0.5);
    // Bounce: when die would go below restY, reflect velocity (damped)
    const bounce1 = restY + Math.max(0, Math.abs(Math.sin(p * Math.PI * 3.2)) * (1-p) * 0.9);
    const bounce2 = restY + Math.max(0, Math.abs(Math.sin(p * Math.PI * 3.5)) * (1-p) * 0.85);
    die1.position.set(-0.5, Math.max(bounce1, Math.max(restY, gravY1)), 0.2);
    die2.position.set( 0.5, Math.max(bounce2, Math.max(restY, gravY2)), 0.0);
    // Free tumble — decelerate angular velocity over time
    const drag = Math.pow(0.15, delta);
    diceAnim.av1.multiplyScalar(drag);
    diceAnim.av2.multiplyScalar(drag);
    die1.rotation.x += diceAnim.av1.x * delta;
    die1.rotation.y += diceAnim.av1.y * delta;
    die1.rotation.z += diceAnim.av1.z * delta;
    die2.rotation.x += diceAnim.av2.x * delta;
    die2.rotation.y += diceAnim.av2.y * delta;
    die2.rotation.z += diceAnim.av2.z * delta;
  } else if (diceAnim.t < diceAnim.duration + diceAnim.settleDur) {
    // Smoothly snap to correct flat-face-up orientation
    const sp = Math.min(1, (diceAnim.t - diceAnim.duration) / diceAnim.settleDur);
    const ease = sp * sp * (3 - 2 * sp);  // smoothstep
    die1.position.y = restY; die2.position.y = restY;
    const r1 = DIE_TOP_ROT[diceAnim.result[0]];
    const r2 = DIE_TOP_ROT[diceAnim.result[1]];
    die1.rotation.x += (r1.x - die1.rotation.x) * ease * 0.3;
    die1.rotation.y += (r1.y - die1.rotation.y) * ease * 0.3;
    die1.rotation.z += (r1.z - die1.rotation.z) * ease * 0.3;
    die2.rotation.x += (r2.x - die2.rotation.x) * ease * 0.3;
    die2.rotation.y += (r2.y - die2.rotation.y) * ease * 0.3;
    die2.rotation.z += (r2.z - die2.rotation.z) * ease * 0.3;
  } else if (!diceAnim.settled) {
    diceAnim.settled = true;
    diceAnim.active  = false;
    const r1 = DIE_TOP_ROT[diceAnim.result[0]];
    const r2 = DIE_TOP_ROT[diceAnim.result[1]];
    die1.rotation.copy(r1); die2.rotation.copy(r2);
    die1.position.y = restY; die2.position.y = restY;
    const _dr = diceAnim.result.slice();
    const fireResult = () => showDiceResult(_dr[0], _dr[1]);
    if (_diceSound.ended || _diceSound.paused) {
      fireResult();
    } else {
      _diceSound.addEventListener('ended', fireResult, { once: true });
      _diceSound.addEventListener('error', fireResult, { once: true });
    }
  }
}

// ─── Model loader ─────────────────────────────────────────────────────────────
const gltfLoader = new GLTFLoader();
// MeshoptDecoder must be ready before any compressed GLB loads
MeshoptDecoder.ready.then(() => {
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  preloadModels(); // move initial load to after decoder is ready
});

// Font for 3D port labels and token numbers — loaded once at startup
let _portFont = null;
let _fontReady = false;
new FontLoader().load('https://unpkg.com/three@0.158.0/examples/fonts/helvetiker_bold.typeface.json', font => {
  _portFont = font;
  _fontReady = true;
  if (gameState) renderBoard(gameState);
  // If intro was waiting on font, fire it now
  if (_pendingIntroHexes && _modelsReady && _pageReady) {
    const hexes = _pendingIntroHexes;
    _pendingIntroHexes = null;
    startTileIntro(hexes);
  }
});

// Drop .glb files in public/models/ with these exact names:
//   settlement.glb, city.glb, road.glb, robber.glb, hex_forest.glb, hex_pasture.glb,
//   hex_fields.glb, hex_hills.glb, hex_mountains.glb, hex_desert.glb
const MODELS = {};
// Key → filename in public/models/ (without .glb)
const MODEL_FILE_MAP = {
  settlement:    'Stone tower',
  city:          'Castle',
  road:          'road',
  robber:        'robber animations',
  bank:          'Bank',
  hex_mountains: 'mountain',
  hex_desert:    'Desert',
  hex_hills:     'brick',
  hex_fields:    'Wheat hex',
  hex_pasture:   'sheep hex',
  sheep:         'Sheep object',
  camel:         'camel object',
  hex_forest:    'wood hex',
  port_brick:  'brick object',
  port_wheat:  'Wheat object',
  port_sheep:  'Sheep object',
  port_wood:   'Wood Log object',
  port_ore:    'Rock Object',
  boat:        'boat object',
};
const MODEL_NAMES = Object.keys(MODEL_FILE_MAP);

// Full GLTF result (scene + animations) stored for robber
const GLTF_DATA = {};

async function tryLoadModel(name, filename) {
  const file = filename || name;
  return new Promise(resolve => {
    gltfLoader.load(
      `models/${file}.glb`,
      gltf => {
        const scene = gltf.scene;
        scene.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
        GLTF_DATA[name] = gltf;  // keep full gltf for animation clips
        resolve(scene);
      },
      undefined,
      () => resolve(null)   // file not found — fall back to procedural
    );
  });
}

async function preloadModels() {
  const results = await Promise.all(MODEL_NAMES.map(n => tryLoadModel(n, MODEL_FILE_MAP[n])));
  MODEL_NAMES.forEach((n, i) => { if (results[i]) MODELS[n] = results[i]; });
  const loaded = MODEL_NAMES.filter(n => MODELS[n]);
  if (loaded.length) console.log('[Models] Loaded:', loaded.join(', '));
  else console.log('[Models] No .glb files found in public/models/ — using procedural meshes');
  _modelsReady = true;
  // Re-render board so models that weren't ready on first render (e.g. sheep) now appear
  if (gameState) {
    renderBoard(gameState);
    // Start deferred intro before renderBuildings so markers see tileIntro.active = true.
    // Also gate on _pageReady — if page isn't loaded yet, window.load handler will fire it.
    if (_pendingIntroHexes && _pageReady && _fontReady) {
      const hexes = _pendingIntroHexes;
      _pendingIntroHexes = null;
      startTileIntro(hexes);
    }
    renderBuildings(gameState);
  }
}

// Clone a model. Pass colorHexVal to tint all meshes (for player pieces); omit to keep original materials.
function cloneModel(name, colorHexVal) {
  const src = MODELS[name];
  if (!src) return null;
  const clone = SkeletonUtils.clone(src);
  if (colorHexVal !== undefined) {
    clone.traverse(c => {
      if (c.isMesh) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        const tinted = mats.map(m => {
          const nm = m.clone();
          nm.color.setHex(colorHexVal);
          // Apply building color tint intensity
          if (SCENE_PARAMS.buildingColorTint !== undefined && SCENE_PARAMS.buildingColorTint < 1) {
            nm.color.lerp(new THREE.Color(0x888888), 1 - SCENE_PARAMS.buildingColorTint);
          }
          nm.roughness = 0.65;
          nm.metalness = 0.05;
          // For near-white players add a white emissive overlay so the tint reads clearly over the texture
          if (colorHexVal >= 0xd0d0d0) { nm.emissive = new THREE.Color(0xffffff); nm.emissiveIntensity = 0.5; }
          nm.needsUpdate = true;
          return nm;
        });
        c.material = Array.isArray(c.material) ? tinted : tinted[0];
        c.castShadow = true;
      }
    });
  }
  return clone;
}

// preloadModels() is called after MeshoptDecoder.ready (see model loader section above)

// ─── Shared textures ──────────────────────────────────────────────────────────
const texLoader = new THREE.TextureLoader();
const cobbleTex = texLoader.load('textures/cobblestone_floor_09.png.webp', t => {
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(0.8, 0.4); t.anisotropy = MAX_ANISOTROPY;
});
const rockyTex = texLoader.load('textures/rocky_trail_02.png.webp', t => {
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 1); t.anisotropy = MAX_ANISOTROPY;
});
const woodTex = texLoader.load('textures/old_wood_floor.png.webp', t => {
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 1); t.anisotropy = MAX_ANISOTROPY;
});

// ─── Constants ────────────────────────────────────────────────────────────────
const HEX_R = 1.2;
const HEX_H = 0.48;
// How far GLB tiles sink into the sand (hides their flat white base)
const TILE_SINK = 0.08;
// Visual height multiplier for GLB tiles (mountains are tallest)
const TILE_HEIGHT_MULT  = { mountains:2.10, hills:1.25, forest:2.05, pasture:1.0,  fields:0.55, desert:1.30 };
const TILE_Y_OFFSET     = { mountains:-0.35, hills:-0.26, forest:-0.18, pasture:-0.39, fields:-0.13, desert:-0.21 };

// Scene-level placement parameters (mutable; sliders update these live)
const SCENE_PARAMS = {
  sandTopY:       -0.49,
  sandBotY:       -1.07,
  sandRadius:      2.60,
  oceanY:         -0.47,
  portY:          -0.22,
  portDist:        0.50,
  portScale:          0.50,
  portIconScale:      2.0,
  portIconY:          0.85,
  boatY:              -0.27,
  boatSpeed:          0.05,
  boatRotOffset:      1.70,
  boatDockOffset:     0.20,
  portIconTextScale:  1.50,
  portIconTextY:      0.20,
  portIconText3dScale: 1.35,
  portIconText3dY:    0.35,
  sheepScale:      0.14,
  sheepY:         -0.06,
  camelScale:      0.18,
  camelY:         -0.33,
  tokenWiggleAmp:  0.45,
  tokenWiggleDur:  1.2,
  tokenWiggleSpd:  14.0,
  settlementY:    -0.60,
  castleY:        -0.14,
  castleSize:      0.83,
  roadY:          -0.57,
  tokenMetalness: 0.88,
  vertexMarkerY:  -0.62,
  edgeMarkerY:    -0.64,
  hexMarkerY:      0.04,
  buildingColorTint: 1.0,
  buildingColorSaturation: 1.0,
  token3dDepth: 0.01,
  token3dScale: 1.30,
  token3dRed: 0x791010,
  token3dSilver: 0x000000,
  token3dRingColor: 0xc8a820,
  tokenRoughness: 0.18,
};

const CAMERA_PRESETS = {
  'Default':      { pos: [0, 13, 11],  target: [0, 0, 0] },
  'Top-Down':     { pos: [0, 16, 0.1], target: [0, 0, 0] },
  'Low Angle':    { pos: [0, 5, 12],   target: [0, 0, 0] },
  'Long Angle':   { pos: [0, 8, 19],   target: [0, 0, 0] },
  'Side':         { pos: [14, 8, 0],   target: [0, 0, 0] },
  'Corner':       { pos: [10, 12, 10], target: [0, 0, 0] },
};
function applyCameraPreset(name) {
  const p = CAMERA_PRESETS[name];
  if (!p) return;
  camera.position.set(...p.pos);
  controls.target.set(...p.target);
  controls.update();
  bloom.strength = name === 'Top-Down' ? 0.0 : LIGHT_PARAMS.bloomStr;
  // Reset zoom slider and camera zoom so preset distances are accurate
  const zoomInput = document.querySelector('[data-param="cameraZoom"] input[type=range]');
  if (zoomInput) { zoomInput.value = 1; zoomInput.dispatchEvent(new Event('input')); }
  camera.zoom = 1; camera.updateProjectionMatrix();
}

// Per-tile-type number token Y offset (defaults match dialled-in screenshot values)
const NUMBER_Y_OFFSET = { mountains:-0.04, hills:-0.18, forest:-0.50, pasture:-0.13, fields:-0.13, desert:0.0 };


const TILE_BASE_COLORS = {
  forest:    0x2d6e2a, pasture:   0xc8f06a, fields:    0xd4a017,
  hills:     0xb5451b, mountains: 0x78909c, desert:    0xc9b98a,
};
const TILE_ROUGHNESS = { forest:0.92, pasture:0.88, fields:0.82, hills:0.95, mountains:0.90, desert:0.70 };
const TILE_METALNESS = { forest:0,    pasture:0,    fields:0,    hills:0,    mountains:0.04, desert:0    };

const PLAYER_COLORS_HEX = {
  '#e74c3c':0xe74c3c,'#3498db':0x3498db,'#ffffff':0xf0f0f0,'#2ecc71':0x2ecc71
};
const PORT_COLORS = {
  wood:0x6b9b37,sheep:0xa8d570,wheat:0xf5c842,brick:0xc0522a,ore:0x8899aa,any:0xdddddd
};
const RES_EMOJI = { wood:'🪵', sheep:'🐑', wheat:'🌾', brick:'🧱', ore:'🪨' };

// ─── Terrain textures ─────────────────────────────────────────────────────────

function makeCanvas(w, h, fn) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  fn(c.getContext('2d'), w, h); return c;
}

function canvasTex(w, h, fn) {
  const t = new THREE.CanvasTexture(makeCanvas(w, h, fn));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1);
  return t;
}

function rnd(a, b) { return a + Math.random() * (b - a); }

const TERRAIN_TEXTURES = {};

function buildTerrainTextures() {
  TERRAIN_TEXTURES.forest = canvasTex(256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,w*0.72);
    g.addColorStop(0, '#3a8032'); g.addColorStop(1, '#1b4a1a');
    ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
    for (let i = 0; i < 38; i++) {
      const x=rnd(0,w), y=rnd(0,h), r=rnd(7,18);
      ctx.fillStyle = `rgba(${~~rnd(15,55)},${~~rnd(65,110)},${~~rnd(10,30)},0.75)`;
      ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    }
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = `rgba(${~~rnd(80,130)},${~~rnd(160,210)},${~~rnd(40,80)},0.18)`;
      ctx.beginPath(); ctx.arc(rnd(0,w),rnd(0,h),rnd(4,9),0,Math.PI*2); ctx.fill();
    }
  });

  TERRAIN_TEXTURES.pasture = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8bc34a'; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle = 'rgba(100,180,50,0.35)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 30; i++) {
      const x=rnd(0,w), y=rnd(0,h);
      ctx.beginPath(); ctx.moveTo(x,y); ctx.bezierCurveTo(x+rnd(-8,8),y-rnd(8,18),x+rnd(-8,8),y-rnd(8,18),x+rnd(-4,4),y-rnd(14,24)); ctx.stroke();
    }
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(255,255,255,${rnd(0.4,0.7)})`;
      const x=rnd(5,w-5), y=rnd(5,h-5), rr=rnd(5,10);
      ctx.beginPath(); ctx.arc(x,y,rr,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(x+rr*0.9,y,rr*0.75,0,Math.PI*2); ctx.fill();
    }
  });

  TERRAIN_TEXTURES.fields = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#d4a017'; ctx.fillRect(0,0,w,h);
    const spacing = 10;
    for (let y = 0; y < h; y += spacing) {
      ctx.strokeStyle = `rgba(${~~rnd(150,180)},${~~rnd(110,140)},${~~rnd(0,20)},0.5)`;
      ctx.lineWidth = rnd(0.8, 2);
      ctx.beginPath(); ctx.moveTo(0, y+rnd(-2,2)); ctx.lineTo(w, y+rnd(-2,2)); ctx.stroke();
    }
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = `rgba(220,180,30,${rnd(0.2,0.4)})`;
      ctx.fillRect(rnd(0,w), rnd(0,h), rnd(2,5), rnd(8,20));
    }
  });

  TERRAIN_TEXTURES.hills = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#b5451b'; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle = 'rgba(90,25,10,0.45)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 12; i++) {
      const cx=rnd(0,w), cy=rnd(0,h), rx=rnd(20,60), ry=rnd(10,30);
      ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,rnd(0,Math.PI),0,Math.PI*2); ctx.stroke();
    }
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `rgba(${~~rnd(60,90)},${~~rnd(20,40)},${~~rnd(5,15)},0.35)`;
      ctx.beginPath(); ctx.arc(rnd(0,w),rnd(0,h),rnd(3,8),0,Math.PI*2); ctx.fill();
    }
  });

  TERRAIN_TEXTURES.mountains = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#78909c'; ctx.fillRect(0,0,w,h);
    // jagged peaks
    for (let i = 0; i < 5; i++) {
      const px = rnd(10,w-10), py = rnd(h*0.2, h*0.8), pw = rnd(30,70), ph = rnd(20,60);
      ctx.fillStyle = `rgba(${~~rnd(100,140)},${~~rnd(100,140)},${~~rnd(110,150)},0.7)`;
      ctx.beginPath(); ctx.moveTo(px,py+ph); ctx.lineTo(px-pw/2,py+ph); ctx.lineTo(px,py); ctx.lineTo(px+pw/2,py+ph); ctx.closePath(); ctx.fill();
      // snow cap
      ctx.fillStyle = 'rgba(240,245,255,0.55)';
      ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(px-pw*0.15,py+ph*0.28); ctx.lineTo(px+pw*0.15,py+ph*0.28); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(50,60,70,0.3)'; ctx.lineWidth = 1;
    for (let i = 0; i < 20; i++) {
      const x=rnd(0,w), y=rnd(0,h);
      ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+rnd(-20,20),y+rnd(-20,20)); ctx.stroke();
    }
  });

  TERRAIN_TEXTURES.desert = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#d4c07a'; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle = 'rgba(160,130,50,0.3)'; ctx.lineWidth = 1;
    for (let i = 0; i < 15; i++) {
      const y = rnd(0,h);
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= w; x += 8) {
        ctx.lineTo(x, y + Math.sin(x * 0.08 + i) * rnd(3,8));
      }
      ctx.stroke();
    }
    for (let i = 0; i < 25; i++) {
      ctx.fillStyle = `rgba(160,130,60,${rnd(0.2,0.45)})`;
      ctx.beginPath(); ctx.arc(rnd(0,w),rnd(0,h),rnd(1.5,4),0,Math.PI*2); ctx.fill();
    }
  });
}

buildTerrainTextures();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeCanvasTexture(fn, w=128, h=128) {
  const t = new THREE.CanvasTexture(makeCanvas(w, h, fn));
  return t;
}

function colorHex(css) { return PLAYER_COLORS_HEX[css] ?? parseInt(css.replace('#',''), 16); }
function clearGroup(g) {
  while (g.children.length) g.remove(g.children[0]);
  if (g === markerGroup) _edgeMarkerMeshes = [];
}

// ─── Number token textures ────────────────────────────────────────────────────
let _tokenScratchTex = null;
function tokenScratchTex() {
  if (_tokenScratchTex) return _tokenScratchTex;
  const sz = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = sz;
  const ctx = canvas.getContext('2d');
  // Base warm gold roughness
  ctx.fillStyle = '#a07820';
  ctx.fillRect(0, 0, sz, sz);
  // Radial polish: centre smoother (low roughness = dark in roughness map), edges rougher
  const radGrad = ctx.createRadialGradient(sz/2,sz/2,sz*0.05, sz/2,sz/2,sz*0.5);
  radGrad.addColorStop(0, 'rgba(30,18,0,0.55)');   // smooth centre
  radGrad.addColorStop(1, 'rgba(220,180,60,0.4)');  // rough edge
  ctx.fillStyle = radGrad;
  ctx.fillRect(0, 0, sz, sz);
  // A few directional brush scratches on gold surface
  const rng = (n) => Math.random() * n;
  for (let i = 0; i < 22; i++) {
    const x0 = rng(sz), y0 = rng(sz);
    const angle = rng(Math.PI * 0.3) - Math.PI * 0.15;
    const len = 10 + rng(sz * 0.5);
    const w = 0.4 + rng(0.8);
    const bright = Math.random() > 0.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + Math.cos(angle)*len, y0 + Math.sin(angle)*len);
    ctx.strokeStyle = bright ? `rgba(255,215,60,${0.18+rng(0.28)})` : `rgba(80,50,0,${0.12+rng(0.20)})`;
    ctx.lineWidth = w;
    ctx.stroke();
  }
  // Fine grain
  const img = ctx.getImageData(0, 0, sz, sz);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    img.data[i]   = Math.max(0, Math.min(255, img.data[i]   + n));
    img.data[i+1] = Math.max(0, Math.min(255, img.data[i+1] + Math.floor(n*0.7)));
    img.data[i+2] = Math.max(0, Math.min(255, img.data[i+2]));
  }
  ctx.putImageData(img, 0, 0);
  _tokenScratchTex = new THREE.CanvasTexture(canvas);
  return _tokenScratchTex;
}

let _tokenAlbedoTex = null;
function tokenAlbedoTex() {
  if (_tokenAlbedoTex) return _tokenAlbedoTex;
  const sz = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = sz;
  const ctx = canvas.getContext('2d');
  // Rich gold base gradient
  const bg = ctx.createRadialGradient(sz*0.42, sz*0.38, sz*0.04, sz/2, sz/2, sz*0.5);
  bg.addColorStop(0,   '#ffe97a');
  bg.addColorStop(0.4, '#d4a020');
  bg.addColorStop(1,   '#7a4800');
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.arc(sz/2, sz/2, sz/2, 0, Math.PI*2); ctx.fill();
  // Visible scratches on the gold surface
  const rng = (n) => Math.random() * n;
  for (let i = 0; i < 28; i++) {
    const x0 = rng(sz), y0 = rng(sz);
    const angle = rng(Math.PI * 0.4) - Math.PI * 0.2;
    const len = 6 + rng(sz * 0.45);
    const w = 0.3 + rng(0.6);
    const bright = Math.random() > 0.45;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + Math.cos(angle)*len, y0 + Math.sin(angle)*len);
    ctx.strokeStyle = bright ? `rgba(255,230,120,${0.25+rng(0.35)})` : `rgba(60,30,0,${0.18+rng(0.22)})`;
    ctx.lineWidth = w;
    ctx.stroke();
  }
  _tokenAlbedoTex = new THREE.CanvasTexture(canvas);
  return _tokenAlbedoTex;
}

function numberTokenTex(num) {
  const red = num === 6 || num === 8;
  return makeCanvasTexture((ctx, w, h) => {
    // Gold coin face — radial gradient from bright centre to rich gold edge
    const bg = ctx.createRadialGradient(w*0.42,h*0.38,w*0.04, w/2,h/2,w*0.48);
    bg.addColorStop(0,   '#fff8d0');
    bg.addColorStop(0.45,'#f0c040');
    bg.addColorStop(1,   '#8a5a00');
    ctx.fillStyle = bg;
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 5;
    ctx.beginPath(); ctx.arc(w/2,h/2,w/2-3,0,Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    // Raised rim ring
    ctx.strokeStyle = 'rgba(255,230,100,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(w/2,h/2,w/2-5,0,Math.PI*2); ctx.stroke();
    ctx.strokeStyle = 'rgba(80,40,0,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(w/2,h/2,w/2-8,0,Math.PI*2); ctx.stroke();
    // Number — chrome silver for normal, shiny red metallic for 6/8
    const twoDigit = num >= 10;
    const fontSize = twoDigit ? ~~(w*0.30) : ~~(w*0.40);
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // Center number+pips block vertically: number sits above mid, pips below
    const pips = num <= 7 ? num - 1 : 13 - num;
    const pipRow = h * (pips > 0 ? 0.76 : 0.5);
    const numY = pips > 0 ? h * (twoDigit ? 0.40 : 0.38) : h * 0.5;
    if (red) {
      const ng = ctx.createLinearGradient(w/2,numY-w*0.22,w/2,numY+w*0.22);
      ng.addColorStop(0, '#ff6060');
      ng.addColorStop(0.5, '#cc0000');
      ng.addColorStop(1, '#7a0000');
      ctx.fillStyle = ng;
      ctx.strokeStyle = 'rgba(40,0,0,0.8)';
    } else {
      const ng = ctx.createLinearGradient(w/2,numY-w*0.22,w/2,numY+w*0.22);
      ng.addColorStop(0, '#ffffff');
      ng.addColorStop(0.4, '#d8e0e8');
      ng.addColorStop(1, '#7090a8');
      ctx.fillStyle = ng;
      ctx.strokeStyle = 'rgba(30,50,70,0.7)';
    }
    ctx.lineWidth = 3;
    ctx.strokeText(String(num), w/2, numY);
    ctx.fillText(String(num), w/2, numY);
    // Probability pips — chrome or red
    ctx.fillStyle = red ? '#cc2020' : '#a0b8cc';
    for (let i = 0; i < pips; i++) {
      ctx.beginPath();
      ctx.arc(w/2 + (i-(pips-1)/2)*9, pipRow, 3, 0, Math.PI*2);
      ctx.fill();
    }
  }, 128, 128);
}

// ─── Board rendering ──────────────────────────────────────────────────────────
function renderBoard(state) {
  clearGroup(boardGroup);
  sheepList.length = 0;
  camelList.length = 0;
  hexShakes.length = 0;
  tokenWiggles.length = 0;
  tokenPulses.length = 0;
  sheepWiggles.length = 0;
  const { hexes, vertices, edges, ports } = state.board;

  // Animated ocean — large plane surrounds the island
  const oceanGeo = new THREE.PlaneGeometry(80, 80, 100, 100);
  oceanGeo.rotateX(-Math.PI / 2);
  const oceanMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:      { value: 0 },
      uDeep:      { value: new THREE.Color(0x006080) },
      uMid:       { value: new THREE.Color(0x00a899) },
      uCrest:     { value: new THREE.Color(0x80e8e0) },
      uWaveAmp:   { value: WATER_PARAMS.waveAmp },
      uWaveSpeed: { value: WATER_PARAMS.waveSpeed },
      uWaveScale: { value: WATER_PARAMS.waveScale },
      uFoamStr:   { value: WATER_PARAMS.foamStr },
      uOpacity:   { value: WATER_PARAMS.opacity },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uWaveAmp;
      uniform float uWaveSpeed;
      uniform float uWaveScale;
      varying float vHeight;
      varying vec2  vWPos;
      varying vec3  vNormal;
      varying vec3  vViewDir;
      void main() {
        vec3 pos = position;
        vWPos = pos.xz;
        float t = uTime * uWaveSpeed;
        float s = uWaveScale;
        float a = uWaveAmp;
        float x = pos.x, z = pos.z;
        float r = max(length(vec2(x, z)), 0.001);
        // Wave displacement
        pos.y = sin(x*0.9*s + t*0.8)   * 0.018*a
              + sin(z*1.1*s + t*0.6)   * 0.015*a
              + sin(x*2.3*s - t*1.1)   * 0.009*a
              + sin(z*1.9*s + t*1.3)   * 0.008*a
              + sin((x-z)*1.4*s+t*0.9) * 0.012*a
              + sin(r*0.6*s - t*0.7)   * 0.014*a;
        vHeight = pos.y;
        // Analytic surface normal via wave partial derivatives
        float dydx = cos(x*0.9*s+t*0.8)*0.9*s*0.018*a
                   + cos(x*2.3*s-t*1.1)*2.3*s*0.009*a
                   + cos((x-z)*1.4*s+t*0.9)*1.4*s*0.012*a
                   + cos(r*0.6*s-t*0.7)*0.6*s*0.014*a*(x/r);
        float dydz = cos(z*1.1*s+t*0.6)*1.1*s*0.015*a
                   + cos(z*1.9*s+t*1.3)*1.9*s*0.008*a
                   + cos((x-z)*1.4*s+t*0.9)*(-1.4*s)*0.012*a
                   + cos(r*0.6*s-t*0.7)*0.6*s*0.014*a*(z/r);
        vNormal = normalize(vec3(-dydx, 1.0, -dydz));
        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3  uDeep;
      uniform vec3  uMid;
      uniform vec3  uCrest;
      uniform float uTime;
      uniform float uFoamStr;
      uniform float uOpacity;
      varying float vHeight;
      varying vec2  vWPos;
      varying vec3  vNormal;
      varying vec3  vViewDir;

      // Cheap 2D hash — no texture needed
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      void main() {
        float distFromIsland = length(vWPos);
        float shoreStart = 3.6;
        float dist = length(vWPos) / 22.0;

        // ── Depth colour ────────────────────────────────────────────────────────
        float depth = clamp((distFromIsland - shoreStart) / 14.0, 0.0, 1.0);
        vec3 shallow = vec3(0.28, 0.82, 0.78);
        vec3 deep    = vec3(0.02, 0.26, 0.46);
        vec3 col = mix(shallow, deep, depth * depth);

        // ── Detail normal (micro-ripple, two layers, fragment-only) ─────────────
        float nx = sin(vWPos.x*13.0 + vWPos.y*9.0  + uTime*1.9) * 0.11
                 + sin(vWPos.x*23.0 - vWPos.y*19.0 - uTime*2.3) * 0.05;
        float nz = sin(vWPos.x*10.0 - vWPos.y*12.0 + uTime*1.5) * 0.11
                 + sin(vWPos.x*20.0 + vWPos.y*24.0 - uTime*2.0) * 0.05;
        vec3 detailN = normalize(vNormal + vec3(nx, 0.0, nz));

        // ── Caustics shimmer (shallow zone) ────────────────────────────────────
        float caus = (sin(vWPos.x*8.0+uTime*1.2)*sin(vWPos.y*7.0+uTime*0.9)+1.0)*0.5
                   * (sin(vWPos.x*5.0-uTime*0.7)*sin(vWPos.y*6.0+uTime*1.1)+1.0)*0.5;
        float shallowMask = 1.0 - smoothstep(shoreStart - 0.3, shoreStart + 2.2, distFromIsland);
        col += vec3(0.06, 0.20, 0.16) * caus * shallowMask * 0.5;

        // ── Subsurface scattering hint (wave peaks glow teal) ──────────────────
        float sss = smoothstep(0.01, 0.038, vHeight);
        col += vec3(0.0, 0.18, 0.14) * sss * 0.35;

        // ── Textured foam band ──────────────────────────────────────────────────
        float foamInner = shoreStart - 0.3;
        float foamOuter = shoreStart + 1.8;
        float foam = smoothstep(foamInner, foamInner + 0.8, distFromIsland)
                   * (1.0 - smoothstep(foamOuter - 0.6, foamOuter, distFromIsland));
        float foamTex = (sin(vWPos.x*14.0+uTime*0.8)*sin(vWPos.y*12.0-uTime*0.6)+1.0)*0.5;
        foamTex = mix(0.65, 1.0, foamTex);
        col = mix(col, vec3(0.94, 0.99, 1.0) * foamTex, foam * uFoamStr);

        // ── Wave crests ─────────────────────────────────────────────────────────
        float crest = smoothstep(0.022, 0.038, vHeight);
        col = mix(col, uCrest, crest * 0.4);

        // ── Fresnel (uses detail normal for fine-grain sky reflection) ──────────
        float NdotV = max(dot(detailN, vViewDir), 0.0);
        float fresnel = pow(1.0 - NdotV, 3.5);
        col = mix(col, vec3(0.48, 0.76, 1.0), fresnel * 0.50);

        // ── Specular sun glint (detail normal gives many small glints) ──────────
        vec3 sunDir = normalize(vec3(2.0, 3.5, 1.5));
        vec3 reflDir = reflect(-vViewDir, detailN);
        float spec = pow(max(dot(reflDir, sunDir), 0.0), 140.0);
        col += vec3(1.0, 0.97, 0.88) * spec * 0.85;

        // ── Sparkle glints (tiny dot per cell, not square) ──────────────────────
        vec2 sgUV = vWPos * 11.0 + vec2(uTime * 0.22, uTime * 0.16);
        vec2 sgCell = floor(sgUV);
        vec2 sgFrac = fract(sgUV) - 0.5; // offset from cell centre
        float h  = hash(sgCell);
        float st = fract(uTime * (0.25 + h * 0.35) + h);
        float twinkle = pow(max(0.0, 1.0 - abs(st - 0.5) * 10.0), 3.0);
        float dotMask = 1.0 - smoothstep(0.04, 0.16, length(sgFrac));
        float sparkle = twinkle * h * dotMask;
        col += vec3(0.88, 0.95, 1.0) * sparkle * 0.65 * (1.0 - foam);

        // ── Horizon haze ────────────────────────────────────────────────────────
        col = mix(col, vec3(0.72, 0.92, 0.96), smoothstep(0.5, 1.0, dist));

        // ── Alpha ───────────────────────────────────────────────────────────────
        float shallowAlpha = smoothstep(shoreStart - 2.5, shoreStart + 3.5, distFromIsland);
        float horizonAlpha = mix(0.96, 0.0, smoothstep(0.78, 1.0, dist));
        gl_FragColor = vec4(col, min(shallowAlpha, horizonAlpha) * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ocean = new THREE.Mesh(oceanGeo, oceanMat);
  ocean.position.y = SCENE_PARAMS.oceanY;
  boardGroup.add(ocean);
  boardGroup.userData.oceanMat = oceanMat;

  // Sandy island base (removed — no sand layer under map)
  const COAST_R = 7.2;
  const sandTopY = SCENE_PARAMS.sandTopY;
  const sandTexLoader = new THREE.TextureLoader();
  const sandTex = sandTexLoader.load('textures/Sand Texture.png');
  sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
  sandTex.repeat.set(8, 8);

  // Bank island — small sandy mound in the water
  const BANK_ANGLE = Math.PI * 0.72;
  const BANK_DIST  = COAST_R - 1.4;
  const bankIslX   = Math.cos(BANK_ANGLE) * BANK_DIST + BANK_PARAMS.posX;
  const bankIslZ   = Math.sin(BANK_ANGLE) * BANK_DIST + BANK_PARAMS.posZ;
  const bankIslR   = BANK_PARAMS.islandR;
  const bankIslH   = BANK_PARAMS.islandH;
  // Island: cone-top cylinder so it looks like a natural sand rise
  const islandGeoTop = new THREE.CylinderGeometry(bankIslR * 0.5, bankIslR, bankIslH, 32, 1);
  const islandGeoBot = new THREE.CylinderGeometry(bankIslR, bankIslR * 1.6, bankIslH * 0.6, 32, 1);
  const islandMatTop = new THREE.ShaderMaterial({
    uniforms: {
      uMap:   { value: sandTex },
      uColor: { value: new THREE.Color(0xd4b87a) },
      uCx:    { value: bankIslX },
      uCz:    { value: bankIslZ },
      uR0:    { value: bankIslR * 0.55 },
      uR1:    { value: bankIslR * 1.05 },
    },
    vertexShader: `
      varying vec3 vWPos;
      void main() {
        vWPos = (modelMatrix * vec4(position,1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      uniform float uCx, uCz, uR0, uR1;
      varying vec3 vWPos;
      void main() {
        vec4 tex = texture2D(uMap, vWPos.xz * 0.18);
        vec3 col = tex.rgb * uColor;
        float d = length(vec2(vWPos.x - uCx, vWPos.z - uCz));
        float a = 1.0 - smoothstep(uR0, uR1, d);
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  const islandMatBot = new THREE.ShaderMaterial({
    uniforms: {
      uMap:   { value: sandTex },
      uColor: { value: new THREE.Color(0xd4b87a) },
      uCx:    { value: bankIslX },
      uCz:    { value: bankIslZ },
      uR0:    { value: bankIslR * 0.85 },
      uR1:    { value: bankIslR * 1.15 },
    },
    vertexShader: `
      varying vec3 vWPos;
      void main() {
        vWPos = (modelMatrix * vec4(position,1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      uniform float uCx, uCz, uR0, uR1;
      varying vec3 vWPos;
      void main() {
        vec4 tex = texture2D(uMap, vWPos.xz * 0.18);
        vec3 col = tex.rgb * uColor;
        float d = length(vec2(vWPos.x - uCx, vWPos.z - uCz));
        float a = 1.0 - smoothstep(uR0, uR1, d);
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  const islandTop = new THREE.Mesh(islandGeoTop, islandMatTop);
  islandTop.position.set(bankIslX, sandTopY + bankIslH / 2 + BANK_PARAMS.height + BANK_PARAMS.posY, bankIslZ);
  islandTop.receiveShadow = true;
  boardGroup.add(islandTop);
  const islandBot = new THREE.Mesh(islandGeoBot, islandMatBot);
  islandBot.position.set(bankIslX, sandTopY - bankIslH * 0.3 + BANK_PARAMS.height + BANK_PARAMS.posY, bankIslZ);
  boardGroup.add(islandBot);
  // Store ref for animate loop
  boardGroup.userData.bankIsland = { x: bankIslX, z: bankIslZ, r: bankIslR };
  boardGroup.userData.bankIslandTop = islandTop;
  boardGroup.userData.bankIslandBot = islandBot;

  // Bank model
  if (MODELS.bank) {
    const bankModel = cloneModel('bank');
    const bb = new THREE.Box3().setFromObject(bankModel);
    const bs = new THREE.Vector3(); bb.getSize(bs);
    const targetScale = (bankIslR * 1.4) / Math.max(bs.x, bs.z, 0.01);
    bankModel.scale.setScalar(targetScale * BANK_PARAMS.scale);
    bankModel.updateWorldMatrix(false, true);
    const bb2 = new THREE.Box3().setFromObject(bankModel);
    const bankGroundY = islandTop.position.y + bankIslH / 2 - bb2.min.y + BANK_PARAMS.height + BANK_PARAMS.posY;
    bankModel.position.set(bankIslX, bankGroundY, bankIslZ);
    bankModel.rotation.y = BANK_PARAMS.rotationY;
    bankModel.castShadow = true;
    boardGroup.add(bankModel);
    boardGroup.userData.bankModel = bankModel;
    boardGroup.userData.bankBaseScale = targetScale;
  }

  // Hex tiles
  hexes.forEach(hex => {
    // Use GLB replacement when available for this tile type
    const hexModelKey = `hex_${hex.type}`;
    const useGLB = !!MODELS[hexModelKey];

    if (useGLB) {
      const hexModel = cloneModel(hexModelKey);
      // Scale so width matches HEX_R*2 and height matches HEX_H exactly
      const hb = new THREE.Box3().setFromObject(hexModel);
      const hs = new THREE.Vector3(); hb.getSize(hs);
      const scaleXZ = (HEX_R * 1.916) / Math.max(hs.x, hs.z, 0.01);
      const heightMult = TILE_HEIGHT_MULT[hex.type] ?? 1.0;
      const scaleY  = (HEX_H * heightMult) / (hs.y || 1);
      hexModel.scale.set(scaleXZ, scaleY, scaleXZ);
      hexModel.updateWorldMatrix(false, true);
      const hb2 = new THREE.Box3().setFromObject(hexModel);
      // Sink tile into sand by TILE_SINK to hide the white flat base
      const yOff = TILE_Y_OFFSET[hex.type] ?? 0;
      hexModel.position.set(hex.x, -HEX_H / 2 - hb2.min.y - TILE_SINK + yOff, hex.z);
      // Random 60° rotation so tiles look varied; forest GLB has an extra 90° correction
      // Mountains are NOT randomised so lava always flows from the same face
      const baseRot = hexModelKey === 'hex_forest' ? Math.PI / 2 : 0;
      const tileRotY = hex.type === 'mountains'
        ? baseRot
        : baseRot + (Math.floor(Math.random() * 6) * Math.PI / 3);
      hexModel.rotation.y = tileRotY;
      hex._tileRotY = tileRotY;
      hexModel.receiveShadow = true;
      hexModel.userData = { type:'hex', hexId: hex.id };
      boardGroup.add(hexModel);

    } else {
      // Main hex cylinder
      const geo = new THREE.CylinderGeometry(HEX_R*0.958, HEX_R*0.958, HEX_H, 6, 1);
      geo.rotateY(Math.PI/6);
      const mat = new THREE.MeshStandardMaterial({
        map: TERRAIN_TEXTURES[hex.type],
        color: new THREE.Color(TILE_BASE_COLORS[hex.type]).multiplyScalar(0.82),
        roughness: TILE_ROUGHNESS[hex.type] ?? 0.88,
        metalness: TILE_METALNESS[hex.type] ?? 0,
        envMapIntensity: 0.4,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const cylYOff = TILE_Y_OFFSET[hex.type] ?? 0;
      mesh.position.set(hex.x, cylYOff, hex.z);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.userData = { type:'hex', hexId: hex.id };
      boardGroup.add(mesh);

      // Top face with slightly lighter color for depth
      const topGeo = new THREE.CircleGeometry(HEX_R*0.955, 6);
      topGeo.rotateY(Math.PI/6);
      const topMat = new THREE.MeshStandardMaterial({
        map: TERRAIN_TEXTURES[hex.type],
        color: new THREE.Color(TILE_BASE_COLORS[hex.type]).multiplyScalar(1.05),
        roughness: TILE_ROUGHNESS[hex.type] ?? 0.88,
        metalness: TILE_METALNESS[hex.type] ?? 0,
        envMapIntensity: 0.5,
      });
      const top = new THREE.Mesh(topGeo, topMat);
      top.rotation.x = -Math.PI/2;
      top.position.set(hex.x, HEX_H/2 + 0.001 + cylYOff, hex.z);
      top.receiveShadow = true;
      top.userData = { type:'hex', hexId: hex.id };
      boardGroup.add(top);

    }

    // Sheep on pasture tiles
    if (hex.type === 'pasture' && MODELS['sheep']) {
      const surfaceY = tileTopY(hex.type);
      // Measure model size from a temp scene add
      const _tmpSheep = cloneModel('sheep');
      scene.add(_tmpSheep);
      _tmpSheep.updateWorldMatrix(true, true);
      const _sb = new THREE.Box3().setFromObject(_tmpSheep);
      const _ss = new THREE.Vector3(); _sb.getSize(_ss);
      scene.remove(_tmpSheep);
      const modelMaxDim = Math.max(_ss.x, _ss.y, _ss.z, 0.01);
      console.log('[Sheep] modelMaxDim=', modelMaxDim, 'scale=', SCENE_PARAMS.sheepScale / modelMaxDim);
      for (let si = 0; si < 5; si++) {
        const angle0 = (si / 5) * Math.PI * 2 + Math.random() * 0.8;
        const tokenR = HEX_R * 0.27;
        const r0 = tokenR + (0.05 + Math.random() * 0.35) * HEX_R;
        const sx = hex.x + Math.cos(angle0) * r0;
        const sz = hex.z + Math.sin(angle0) * r0;
        const sheep = cloneModel('sheep');
        const sc = SCENE_PARAMS.sheepScale / modelMaxDim;
        sheep.scale.setScalar(sc);
        sheep.position.set(sx, surfaceY + SCENE_PARAMS.sheepY, sz);
        sheep.rotation.y = Math.random() * Math.PI * 2;
        sheep.userData.hexId = hex.id;
        boardGroup.add(sheep);
        // Pick random wander target within hex
        const ta = Math.random() * Math.PI * 2;
        const tr = (0.1 + Math.random() * 0.5) * HEX_R;
        sheepList.push({
          mesh: sheep,
          cx: hex.x, cz: hex.z,
          tx: hex.x + Math.cos(ta) * tr,
          tz: hex.z + Math.sin(ta) * tr,
          speed: 0.04 + Math.random() * 0.04,
          bobT: Math.random() * Math.PI * 2,
          bobSpeed: 1.5 + Math.random(),
          surfaceY: surfaceY,
          modelMaxDim: modelMaxDim,
        });
      }
    }

    // Camels on desert tiles
    if (hex.type === 'desert' && MODELS['camel']) {
      const surfaceY = tileTopY(hex.type);
      const _tmpCamel = cloneModel('camel');
      scene.add(_tmpCamel);
      _tmpCamel.updateWorldMatrix(true, true);
      const _cb = new THREE.Box3().setFromObject(_tmpCamel);
      const _cs = new THREE.Vector3(); _cb.getSize(_cs);
      scene.remove(_tmpCamel);
      const modelMaxDim = Math.max(_cs.x, _cs.y, _cs.z, 0.01);
      for (let ci = 0; ci < 3; ci++) {
        const angle0 = (ci / 3) * Math.PI * 2 + Math.random() * 0.9;
        const tokenR = HEX_R * 0.27;
        const r0 = tokenR + (0.1 + Math.random() * 0.35) * HEX_R;
        const cx = hex.x + Math.cos(angle0) * r0;
        const cz = hex.z + Math.sin(angle0) * r0;
        const camel = cloneModel('camel');
        const sc = SCENE_PARAMS.camelScale / modelMaxDim;
        camel.scale.setScalar(sc);
        camel.position.set(cx, surfaceY + SCENE_PARAMS.camelY, cz);
        camel.rotation.y = Math.random() * Math.PI * 2;
        camel.userData.hexId = hex.id;
        camel.userData.isCamel = true;
        boardGroup.add(camel);
        const ta = Math.random() * Math.PI * 2;
        const tr = (0.1 + Math.random() * 0.5) * HEX_R;
        camelList.push({
          mesh: camel,
          cx: hex.x, cz: hex.z,
          tx: hex.x + Math.cos(ta) * tr,
          tz: hex.z + Math.sin(ta) * tr,
          speed: 0.025 + Math.random() * 0.025,
          bobT: Math.random() * Math.PI * 2,
          bobSpeed: 0.9 + Math.random() * 0.5,
          surfaceY: surfaceY,
          modelMaxDim: modelMaxDim,
        });
      }
    }

    // Number token disc — sits on top of the tile surface
    if (hex.number) {
      const tokenY = tileTopY(hex.type);
      const discBaseY = tokenY + 0.025 + (NUMBER_Y_OFFSET[hex.type] ?? 0);

      // Gold coin disc
      const discGeo = new THREE.CylinderGeometry(HEX_R*0.27, HEX_R*0.265, 0.09, 28);
      const discMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: tokenAlbedoTex(),
        roughnessMap: tokenScratchTex(),
        roughness: SCENE_PARAMS.tokenRoughness ?? 0.18,
        metalness: SCENE_PARAMS.tokenMetalness ?? 0.92,
        envMapIntensity: 2.5,
      });
      discMat.userData = { isTokenDisc: true };
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.position.set(hex.x, discBaseY, hex.z);
      disc.castShadow = true;
      disc.userData.tokenHexId = hex.id;
      boardGroup.add(disc);

      // 3D extruded number on top of the coin
      if (_portFont) {
        const isRed = hex.number === 6 || hex.number === 8;
        const textGeo = new TextGeometry(String(hex.number), {
          font: _portFont,
          size: HEX_R * 0.13 * SCENE_PARAMS.token3dScale,
          height: SCENE_PARAMS.token3dDepth,
          curveSegments: 6,
          bevelEnabled: true,
          bevelThickness: 0.008,
          bevelSize: 0.006,
          bevelSegments: 2,
        });
        textGeo.computeBoundingBox();
        const bb = textGeo.boundingBox;
        const cx = (bb.max.x - bb.min.x) / 2;
        const cz = (bb.max.y - bb.min.y) / 2;
        const numMat = new THREE.MeshStandardMaterial({
          color: isRed ? SCENE_PARAMS.token3dRed : SCENE_PARAMS.token3dSilver,
          metalness: 0.90,
          roughness: isRed ? 0.22 : 0.10,
          envMapIntensity: 3.0,
        });
        // For red tokens, center the number+pips group on the coin
        const pipR = HEX_R * 0.022;
        const pipGap = HEX_R * 0.02;
        const groupShift = isRed ? (cz + pipGap + pipR) / 2 : 0;

        const numMesh = new THREE.Mesh(textGeo, numMat);
        numMesh.rotation.x = -Math.PI / 2;
        numMesh.position.set(hex.x - cx, discBaseY + 0.048, hex.z + cz - groupShift);
        numMesh.castShadow = false;
        numMesh.userData.tokenHexId = hex.id;
        boardGroup.add(numMesh);

        // Beveled ring around coin edge
        const ringGeo = new THREE.TorusGeometry(HEX_R * 0.268, 0.018, 8, 36);
        const ringMat = new THREE.MeshStandardMaterial({
          color: SCENE_PARAMS.token3dRingColor,
          metalness: 0.95,
          roughness: 0.10,
          envMapIntensity: 3.0,
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = Math.PI / 2;
        ringMesh.position.set(hex.x, discBaseY + 0.052, hex.z);
        ringMesh.userData.tokenHexId = hex.id;
        boardGroup.add(ringMesh);

        // Probability pips for 6 and 8
        if (isRed) {
          const pipCount = 5;
          const pipGeo = new THREE.CylinderGeometry(pipR, pipR, 0.012, 8);
          const spacing = HEX_R * 0.055;
          const totalW = (pipCount - 1) * spacing;
          const pipZ = hex.z + groupShift; // symmetric with number shift
          for (let p = 0; p < pipCount; p++) {
            const pipMesh = new THREE.Mesh(pipGeo, numMat);
            pipMesh.position.set(hex.x - totalW / 2 + p * spacing, discBaseY + 0.048, pipZ);
            pipMesh.userData.tokenHexId = hex.id;
            boardGroup.add(pipMesh);
          }
        }
      }
    }
  });

  // Mountain hex clouds
  if (CLOUD_PARAMS.enabled) {
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1, metalness: 0,
      transparent: true, opacity: CLOUD_PARAMS.opacity,
      envMapIntensity: 0, emissive: 0xffffff, emissiveIntensity: 0.04,
      depthWrite: false,
    });
    const puffOffsets = [[0,0,0,1],[1.0,0.1,0.2,0.7],[-0.9,0,-0.2,0.65],[0.35,0.38,0,0.58],[-0.28,0.32,0.28,0.5]];
    hexes.filter(h => h.type === 'mountains').forEach(hex => {
      const baseY = tileTopY('mountains');
      const rng = (s) => { let x=Math.sin(s*127.1)*43758.5453; return x-Math.floor(x); };
      // Use a seed that mixes hex.id with a random salt so clouds vary between games
      const salt = Math.floor(Math.random() * 9973);
      const seed = hex.id * 7919 + salt;
      const numClouds = Math.max(0, Math.round((2 + Math.floor(rng(seed) * 2)) * CLOUD_PARAMS.amount));
      for (let ci = 0; ci < numClouds; ci++) {
        const ang = rng(seed + ci) * Math.PI * 2;
        const r   = CLOUD_PARAMS.spread * (0.3 + rng(seed + ci + 1) * 0.7) * HEX_R;
        const cx  = hex.x + Math.cos(ang) * r;
        const cz  = hex.z + Math.sin(ang) * r;
        const cy  = baseY + CLOUD_PARAMS.height * (0.8 + rng(seed + ci + 2) * 0.4);
        const sc  = CLOUD_PARAMS.scale * (0.7 + rng(seed + ci + 3) * 0.6);
        const cg  = new THREE.Group();
        cg.userData = { cloudBase: cy, cloudSeed: seed + ci * 31, cloudIdx: ci, hexId: hex.id, cloudBaseOffX: cx - hex.x, cloudBaseOffZ: cz - hex.z };
        // Randomise each puff's position/size per cloud so no two clouds look identical
        puffOffsets.forEach(([bx,by,bz,bs], pi) => {
          const jx = (rng(seed + ci * 17 + pi * 5    ) - 0.5) * 0.7;
          const jy = (rng(seed + ci * 17 + pi * 5 + 1) - 0.5) * 0.3;
          const jz = (rng(seed + ci * 17 + pi * 5 + 2) - 0.5) * 0.7;
          const js = 0.65 + rng(seed + ci * 17 + pi * 5 + 3) * 0.7;
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.9 * bs * js, 7, 5), cloudMat.clone());
          m.position.set(bx + jx, by + jy, bz + jz); m.scale.set(1.6, 0.9, 1.0); cg.add(m);
        });
        cg.position.set(cx, cy, cz);
        cg.scale.setScalar(sc);
        boardGroup.add(cg);
        boardGroup.userData.mountainClouds = boardGroup.userData.mountainClouds ?? [];
        boardGroup.userData.mountainClouds.push(cg);
      }
    });
  }

  // ── Lava flows on mountain tiles ──────────────────────────────────────────────
  buildLava(hexes);

  // Port markers — dock + two roads to hex edge vertices + sign
  const PORT_LABELS = { wood:'🪵 2:1', sheep:'🐑 2:1', wheat:'🌾 2:1', brick:'🧱 2:1', ore:'🪨 2:1', any:'? 3:1' };
  const PORT_BG     = { wood:0x4a7c20, sheep:0x88b840, wheat:0xd4a010, brick:0xb03010, ore:0x607080, any:0xdddddd };
  const dockTex = woodTex.clone(); dockTex.needsUpdate = true;
  dockTex.repeat.set(3, 3); dockTex.wrapS = dockTex.wrapT = THREE.RepeatWrapping;
  const woodPortMat = new THREE.MeshStandardMaterial({ map: dockTex, color:0xb87a3a, roughness:0.92, metalness:0.0 });
  const dockPositions = [];
  ports.forEach(port => {
    const v1 = vertices[port.vertices[0]], v2 = vertices[port.vertices[1]];
    const ex = v2.x-v1.x, ez = v2.z-v1.z;
    const edgeLen = Math.sqrt(ex*ex+ez*ez);
    const nx = ez/edgeLen, nz = -ex/edgeLen; // outward normal (CW vertex order)
    const dockDist = SCENE_PARAMS.portDist;
    const midX = (v1.x+v2.x)/2, midZ = (v1.z+v2.z)/2;
    const portY = -HEX_H/2 + SCENE_PARAMS.portY;

    // ── Dock platform (in world space, not a child group, so roads sit correctly)
    const portGroup = new THREE.Group();
    const dx = midX + nx*dockDist, dz = midZ + nz*dockDist;
    const tx = -nz, tz = nx; // tangent along dock face
    dockPositions.push({ cx: dx, cz: dz, nx, nz, tx, tz, spots: [null, null, null] });
    const angle = Math.atan2(nx, nz);
    portGroup.position.set(dx, portY, dz);
    portGroup.rotation.y = angle;
    portGroup.scale.setScalar(SCENE_PARAMS.portScale);
    portGroup.userData.baseY = portY;
    portGroup.userData.bobPhase = Math.random() * Math.PI * 2;
    if (!boardGroup.userData.portGroups) boardGroup.userData.portGroups = [];
    boardGroup.userData.portGroups.push(portGroup);

    const dockGeo = new THREE.BoxGeometry(1.0, 0.08, 0.7);
    const dock = new THREE.Mesh(dockGeo, woodPortMat); dock.position.y = 0.04; dock.castShadow = true;
    portGroup.add(dock);

    // Single 3D icon above dock (no pole)
    const resType = port.type;
    const iconGroup = new THREE.Group();
    const iconScale      = SCENE_PARAMS.portIconScale ?? 2.0;
    const iconY          = SCENE_PARAMS.portIconY ?? 0.55;
    const textScale      = SCENE_PARAMS.portIconTextScale ?? 1.0;
    const textY          = SCENE_PARAMS.portIconTextY ?? 0.0;
    const text3dScale    = SCENE_PARAMS.portIconText3dScale ?? 1.0;
    const text3dY        = SCENE_PARAMS.portIconText3dY ?? 0.0;
    iconGroup.position.set(0, iconY, 0);
    iconGroup.scale.setScalar(iconScale);

    // Helper: build a plain text mesh (no stroke/outline)
    function makeOutlineText(str, size, height, color, emissive, scale, posY) {
      if (!_portFont) return;
      const geo = new TextGeometry(str, { font: _portFont, size, height, curveSegments: 6, bevelEnabled: false });
      geo.computeBoundingBox();
      const tw = geo.boundingBox.max.x - geo.boundingBox.min.x;
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.3, emissive, emissiveIntensity: 0.3 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.setScalar(scale);
      mesh.position.set(-tw * scale / 2, posY, 0);
      portGroup.add(mesh);
    }

    if (resType === 'any') {
      // 3:1 — vertical 3D text only (text3dY is independent, not relative to iconY)
      makeOutlineText('3:1', 0.22, 0.08, 0xffffff, 0xffffff, text3dScale, text3dY);
    } else {
      // Try GLB model first, fall back to geometry
      const portModelKey = `port_${resType}`;
      let resObj = null;
      if (MODELS[portModelKey]) {
        resObj = cloneModel(portModelKey);
        const bb = new THREE.Box3().setFromObject(resObj);
        const sz = new THREE.Vector3(); bb.getSize(sz);
        resObj.scale.setScalar(0.32 / Math.max(sz.x, sz.y, sz.z, 0.01));
        resObj.castShadow = true;
      } else {
        const mat = new THREE.MeshStandardMaterial({ color: 0x8090a0, roughness: 0.65, metalness: 0.3 });
        resObj = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), mat);
        resObj.castShadow = true;
      }
      iconGroup.add(resObj);

      // 2:1 text fixed in portGroup — textY is independent, not relative to iconY
      makeOutlineText('2:1', 0.16, 0.05, 0xffffff, 0xffffff, textScale, textY);
    }

    iconGroup.userData.portType = resType;
    portGroup.add(iconGroup);
    if (!boardGroup.userData.portIcons) boardGroup.userData.portIcons = [];
    boardGroup.userData.portIcons.push(iconGroup);

    boardGroup.add(portGroup);

    // ── Two roads from dock to each edge vertex
    const portScale = SCENE_PARAMS.portScale;
    const roadY = portY;
    [v1, v2].forEach(vx => {
      const rdx = vx.x - dx, rdz = vx.z - dz;
      const rlen = Math.sqrt(rdx*rdx + rdz*rdz);
      const roadGeo = new THREE.BoxGeometry(rlen * 0.88, 0.07, 0.16 * portScale);
      const roadMat = new THREE.MeshStandardMaterial({ color:0x9a6a3a, roughness:0.88, metalness:0.02 });
      const roadMesh = new THREE.Mesh(roadGeo, roadMat);
      roadMesh.position.set((dx+vx.x)/2, roadY, (dz+vx.z)/2);
      roadMesh.rotation.y = Math.atan2(-rdz, rdx);
      roadMesh.castShadow = true;
      roadMesh.userData.portRoadBaseY = roadY;
      boardGroup.add(roadMesh);
      if (!boardGroup.userData.portRoads) boardGroup.userData.portRoads = [];
      boardGroup.userData.portRoads.push(roadMesh);
    });
  });

  // ── Boats: 6 boats roaming between docks via the outer water ring ────────
  if (dockPositions.length >= 2 && MODELS['boat']) {
    const SPOT_TAN = [-0.28, 0, 0.28]; // tangential offsets for the 3 side-by-side spots
    // push boat outward from dock center so it sits at the dock's outer face
    const spotPos = (dock, si) => {
      const offset = SCENE_PARAMS.boatDockOffset ?? 0.20;
      return {
        x: dock.cx + dock.nx * offset + dock.tx * SPOT_TAN[si],
        z: dock.cz + dock.nz * offset + dock.tz * SPOT_TAN[si],
      };
    };

    const NUM_BOATS = 6;
    const boats = [];
    for (let bi = 0; bi < NUM_BOATS; bi++) {
      const dockIdx = bi % dockPositions.length;
      const dock = dockPositions[dockIdx];
      const si = dock.spots.indexOf(null);
      if (si === -1) continue;
      dock.spots[si] = bi;
      const pos = spotPos(dock, si);
      const boatMesh = cloneModel('boat');
      const bb = new THREE.Box3().setFromObject(boatMesh);
      const sz = new THREE.Vector3(); bb.getSize(sz);
      boatMesh.scale.setScalar(0.55 / Math.max(sz.x, sz.y, sz.z, 0.01));
      boatMesh.position.set(pos.x, SCENE_PARAMS.boatY, pos.z);
      boatMesh.castShadow = true;
      boardGroup.add(boatMesh);
      boats.push({
        mesh: boatMesh,
        dockIdx, spotIdx: si,
        fromAngle: Math.atan2(dock.cz, dock.cx),
        toAngleDiff: 0,
        travelStart: 0, travelDuration: 0,
        targetDockIdx: -1, targetSpotIdx: -1,
        dockArrivalT: -(bi * 10), // stagger departures
      });
    }
    boardGroup.userData.boats = boats;
    boardGroup.userData.dockPositions = dockPositions;
    // spotPos reads SCENE_PARAMS.boatDockOffset live so the slider works
    boardGroup.userData.spotPos = (dock, si) => {
      const offset = SCENE_PARAMS.boatDockOffset ?? 0.20;
      return {
        x: dock.cx + dock.nx * offset + dock.tx * SPOT_TAN[si],
        z: dock.cz + dock.nz * offset + dock.tz * SPOT_TAN[si],
      };
    };
  }

  // Tag all hex/token children with their resting base position for bobbing + intro
  tileBobPhases.clear();
  boardGroup.children.forEach(child => {
    const hid = child.userData.hexId ?? child.userData.tokenHexId;
    if (hid === undefined) return;
    child.userData.baseX = child.position.x;
    child.userData.baseY = child.position.y;
    child.userData.baseZ = child.position.z;
    if (!tileBobPhases.has(hid)) tileBobPhases.set(hid, Math.random() * Math.PI * 2);
  });

  // First-time intro animation — defer until models, font, and page are all ready
  if (!_introDone) {
    _introDone = true;
    if (_modelsReady && _pageReady && _fontReady) {
      startTileIntro(state.board.hexes);
    } else {
      _pendingIntroHexes = state.board.hexes;
    }
  }

  // Keep selectedObjects empty — portRise completion will populate it after icons surface
}

// ─── Tile intro fly-in animation ──────────────────────────────────────────────
function startTileIntro(hexes) {
  tileIntro.active = true;
  tileIntro.t = 0;
  tileIntro.duration = 7.0;
  tileIntro.hexes = hexes;
  tileIntro.hexOffsets.clear();
  tileIntro.hexCollOff = new Map();
  tileIntro.shakeTriggered = false;

  // Tiles push outward proportionally to their distance from center,
  // so the board shape is preserved and collapses inward without overlaps.
  // Center (dist≈0) → 0.3 units; outer ring (dist≈max) → 2.0 units.
  const maxHexDist = HEX_R * Math.sqrt(3) * 2; // ≈4.16, outer ring radius
  hexes.forEach(hex => {
    const hexDist = Math.sqrt(hex.x * hex.x + hex.z * hex.z);
    const t = maxHexDist > 0 ? Math.min(1, hexDist / maxHexDist) : 0;
    const scatter = 0.3 + t * 1.7; // 0.3 (center) to 2.0 (outer ring)
    const angle = (hex.x === 0 && hex.z === 0)
      ? Math.PI / 4 // center tile has no outward direction; pick arbitrary
      : Math.atan2(hex.z, hex.x);
    tileIntro.hexOffsets.set(hex.id, {
      x0: Math.cos(angle) * scatter,
      z0: Math.sin(angle) * scatter,
    });
    tileIntro.hexCollOff.set(hex.id, { x: 0, z: 0 });
  });

  // Move all hex children to scatter start positions; hide tokens until they fall from sky
  boardGroup.children.forEach(child => {
    if (child.userData.tokenHexId !== undefined) {
      child.visible = false;
      return;
    }
    const hid = child.userData.hexId;
    if (hid === undefined) return;
    const off = tileIntro.hexOffsets.get(hid);
    if (!off) return;
    child.position.x = child.userData.baseX + off.x0;
    child.position.z = child.userData.baseZ + off.z0;
    child.position.y = child.userData.baseY - 1.2;
  });

  // Submerge ports, dock roads, and boats at opacity 0 so they rise+fade after intro
  boardGroup.userData._portRiseOff = -2.5;
  boardGroup.userData.portRise = null;
  (boardGroup.userData.portGroups ?? []).forEach(pg => {
    pg.position.y = pg.userData.baseY - 2.5;
    pg.traverse(c => { if (c.isMesh && c.material) { c.material.transparent = true; c.material.opacity = 0; c.material.needsUpdate = true; } });
  });
  (boardGroup.userData.portRoads ?? []).forEach(r => {
    r.position.y = r.userData.portRoadBaseY - 2.5;
    r.material.transparent = true; r.material.opacity = 0; r.material.needsUpdate = true;
  });
  (boardGroup.userData.boats ?? []).forEach(b => {
    b.mesh.position.y = SCENE_PARAMS.boatY - 2.5;
    b.mesh.traverse(c => { if (c.isMesh && c.material) { c.material.transparent = true; c.material.opacity = 0; c.material.needsUpdate = true; } });
  });
  // Defensively hide any markers already in markerGroup (covers all timing paths)
  if (markerGroup.children.length) {
    markerGroup.userData.pendingAppear = true;
    markerGroup.children.forEach(m => {
      if (m.material) { m.material.transparent = true; m.material.opacity = 0; }
      if (m.userData.markerType === 'vertex') {
        m.position.y = (m.userData.baseY ?? 0) + SCENE_PARAMS.vertexMarkerY - 2.5;
      }
    });
  }

  // Hide robber during intro; it drops from sky after tokens
  if (robberAnim.mesh) robberAnim.mesh.visible = false;

  // Set camera to Long Angle; it stays here through token + robber animations
  camera.position.set(0, 5.5, 13);
  controls.target.set(0, 0, 0);
  controls.update();
  controls.enabled = false;
  cameraIntro.active = false;
  cameraIntro.t = 0;
  cameraIntro.waitT = 0;
  cameraIntro.waiting = false; // triggered manually after robber voice-over

  _waterIntroSound.currentTime = 0;
  _waterIntroSound.volume = 0.55;
  _waterIntroSound.play().catch(() => {});
}

function startTokenIntro() {
  if (!gameState) return;
  const SPIRAL = [...SPIRAL_QR_OUTER, ...SPIRAL_QR_INNER, [0, 0]];

  // Index token meshes and tile meshes by hexId
  const tokenMeshMap = new Map();
  const tileMeshMap  = new Map();
  boardGroup.children.forEach(c => {
    const tid = c.userData.tokenHexId;
    if (tid !== undefined) {
      if (!tokenMeshMap.has(tid)) tokenMeshMap.set(tid, []);
      tokenMeshMap.get(tid).push(c);
    }
    const hid = c.userData.hexId;
    if (hid !== undefined) {
      if (!tileMeshMap.has(hid)) tileMeshMap.set(hid, []);
      tileMeshMap.get(hid).push(c);
    }
  });

  tokenIntro.active = true;
  tokenIntro.t = 0;
  tokenIntro.done = false;
  tokenIntro.scheduled = [];
  tokenIntro.landings = [];

  let slot = 0;
  for (const [q, r] of SPIRAL) {
    const hex = gameState.board.hexes.find(h => h.q === q && h.r === r);
    if (!hex || hex.type === 'desert' || !hex.number) continue;
    const meshes = tokenMeshMap.get(hex.id) ?? [];
    if (!meshes.length) continue;
    const baseYs = meshes.map(m => m.userData.baseY ?? m.position.y);
    meshes.forEach(m => { m.position.y = 15; m.visible = false; }); // raised to sky, hidden until fall begins
    tokenIntro.scheduled.push({
      hexId: hex.id,
      startT: slot * 0.3,
      tokenMeshes: meshes,
      baseYs,
      tileMeshes: tileMeshMap.get(hex.id) ?? [],
      landed: false,
    });
    slot++;
  }
}

function startRobberDrop() {
  if (!robberAnim.mesh || !gameState) return;
  const desertHex = gameState.board.hexes.find(h => h.type === 'desert');
  if (!desertHex) return;
  robberDropIntro.active = true;
  robberDropIntro.t = 0;
  robberDropIntro.targetY = robberAnim.baseY ?? robberAnim.mesh.position.y;
  robberAnim.mesh.position.y = 15;
  robberAnim.mesh.visible = true;
}

function robberVoVolume() {
  if (!robberAnim.mesh) return 0;
  const dist = camera.position.distanceTo(robberAnim.mesh.position);
  const MIN_DIST = 2;   // at or closer than this → full 5%
  const MAX_DIST = 12;  // at or farther than this → silent
  const t = Math.max(0, Math.min(1, (dist - MIN_DIST) / (MAX_DIST - MIN_DIST)));
  return 0.05 * (1 - t * t); // quadratic falloff
}

function playRobberVoLoop() {
  if (!_robberVoEnabled || _robberVoPlaying) return;
  _robberVoPlaying = true;
  const voFile = VO_FILES[Math.floor(Math.random() * VO_FILES.length)];
  const vo = new Audio('voice over/' + encodeURIComponent(voFile));
  vo.volume = robberVoVolume();
  _robberVoAudio = vo;
  const onDone = () => {
    _robberVoPlaying = false;
    _robberVoAudio = null;
    if (_robberVoEnabled) {
      const gap = 3000 + Math.random() * 5000;
      _robberVoTimer = setTimeout(playRobberVoLoop, gap);
    }
  };
  vo.addEventListener('ended', onDone, { once: true });
  vo.addEventListener('error', onDone, { once: true });
  vo.play().catch(onDone);
}

function spawnTokenDebris(x, baseY, z) {
  const colors = [0xf5c842, 0xfde68a, 0xd4a000, 0xffffff, 0xe0c060];
  for (let i = 0; i < 14; i++) {
    const geo = new THREE.BoxGeometry(0.05 + Math.random() * 0.05, 0.04, 0.05 + Math.random() * 0.05);
    const mat = new THREE.MeshBasicMaterial({ color: colors[Math.floor(Math.random() * colors.length)] });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x + (Math.random() - 0.5) * 0.3, baseY + 0.15, z + (Math.random() - 0.5) * 0.3);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    scene.add(mesh);
    const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.5;
    const speed = 1.8 + Math.random() * 2.5;
    debrisParticles.push({
      mesh,
      vx: Math.cos(angle) * speed * 0.6,
      vy: 2.5 + Math.random() * 2.5,
      vz: Math.sin(angle) * speed * 0.6,
      rx: (Math.random() - 0.5) * 8,
      rz: (Math.random() - 0.5) * 8,
      t: 0,
      lifetime: 0.45 + Math.random() * 0.3,
    });
  }
}

// ─── Lava builder (called from renderBoard + whenever LAVA_PARAMS change) ────
function buildLava(hexes) {
  hexes = hexes ?? (gameState?.board?.hexes ?? []);
  // Clear old meshes
  if (boardGroup.userData.lavaMeshes) {
    boardGroup.userData.lavaMeshes.forEach(m => {
      boardGroup.remove(m);
      m.geometry?.dispose();
      if (Array.isArray(m.material)) m.material.forEach(x => x.dispose());
      else m.material?.dispose();
    });
  }
  boardGroup.userData.lavaMeshes = [];
  boardGroup.userData.lavaSteamOrigins = [];

  const peakY = tileTopY('mountains');

  // Gradient alphaMap: opaque at start of tube (U=0), transparent at end (U=1)
  const fadeCv = document.createElement('canvas'); fadeCv.width = 128; fadeCv.height = 4;
  const fCtx = fadeCv.getContext('2d');
  const fGrd = fCtx.createLinearGradient(0, 0, 128, 0);
  fGrd.addColorStop(0.0, 'white');
  fGrd.addColorStop(0.55, 'white');
  fGrd.addColorStop(1.0, 'black');
  fCtx.fillStyle = fGrd; fCtx.fillRect(0, 0, 128, 4);
  const fadeTex = new THREE.CanvasTexture(fadeCv);

  const lavaMat = () => new THREE.MeshStandardMaterial({
    color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 1.8,
    roughness: 0.55, metalness: 0.1,
    transparent: true, alphaMap: fadeTex, depthWrite: false,
  });

  // Single global direction so all mountain tiles look identical
  const angle = LAVA_PARAMS.riverRotation;
  const ca = Math.cos(angle), sa = Math.sin(angle);

  // Tilt rotation (pitch) in the vertical plane of flow
  const cosT = Math.cos(LAVA_PARAMS.riverTilt), sinT = Math.sin(LAVA_PARAMS.riverTilt);
  // Base path: [xzDist, yDist] pairs — tilt rotates these in the (xz, y) plane
  const basePts = [[0.08, 0.02], [0.22, -0.12], [0.40, -0.28], [0.60, -0.44], [0.78, -0.58]];
  function tiltPt(xzD, yD) {
    return { xz: xzD * cosT - yD * sinT, y: xzD * sinT + yD * cosT };
  }

  // Only the currently erupting tile gets lava
  hexes.filter(h => h.type === 'mountains' && h.id === _lavaEruption.activeTileId).forEach(hex => {
    // ── River ──────────────────────────────────────────────────────────────────
    if (LAVA_PARAMS.riverEnabled > 0.5) {
      const rx = LAVA_PARAMS.riverX, ry = LAVA_PARAMS.riverY, rz = LAVA_PARAMS.riverZ;
      const pts = basePts.map(([xzD, yD]) => {
        const tp = tiltPt(xzD, yD);
        return new THREE.Vector3(hex.x + ca * tp.xz + rx, peakY + tp.y + ry, hex.z + sa * tp.xz + rz);
      });
      const curve = new THREE.CatmullRomCurve3(pts);
      const radius = 0.052 * LAVA_PARAMS.riverScale;
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, radius, 7, false), lavaMat());
      tube.userData = { hexId: hex.id, isLava: true, lavaKind: 'river',
        lavaPhase: (hex.id * 1.618) % (Math.PI * 2), _lavaBaseY: 0 };
      boardGroup.add(tube);
      boardGroup.userData.lavaMeshes.push(tube);

      // Steam origin = tip of river (where lava hits the tile edge / "ocean")
      const tip = pts[pts.length - 1];
      boardGroup.userData.lavaSteamOrigins.push({ x: tip.x, y: tip.y, z: tip.z });
    }

    // ── Ball ───────────────────────────────────────────────────────────────────
    if (LAVA_PARAMS.ballEnabled > 0.5) {
      const bx = hex.x + ca * 0.08 + LAVA_PARAMS.ballX;
      const by = peakY + LAVA_PARAMS.ballY;
      const bz = hex.z + sa * 0.08 + LAVA_PARAMS.ballZ;
      const bRadius = 0.09 * LAVA_PARAMS.ballScale;
      const blob = new THREE.Mesh(new THREE.SphereGeometry(bRadius, 9, 7), lavaMat());
      blob.scale.y = LAVA_PARAMS.ballScaleY;
      blob.position.set(bx, by, bz);
      blob.userData = { hexId: hex.id, isLava: true, lavaKind: 'ball',
        lavaPhase: ((hex.id * 3.14) % (Math.PI * 2)) + 1.2, _lavaBaseY: by };
      boardGroup.add(blob);
      boardGroup.userData.lavaMeshes.push(blob);
    }
  });
}

function spawnWaterRing(x, z, color = 0x90ecff) {
  const s = WATER_SPRITE_PARAMS.size;
  const geo = new THREE.RingGeometry(s * 0.25, s, 16);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: WATER_SPRITE_PARAMS.opacity, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, SCENE_PARAMS.oceanY + 0.03, z);
  scene.add(mesh);
  waterRings.push({ mesh, t: 0, duration: 0.9 });
}

// ─── Apply bank params live ───────────────────────────────────────────────────
function applyBankParams() {
  const bg = boardGroup;
  if (!bg) return;
  const bankModel = bg.userData.bankModel;
  const islandTop = bg.userData.bankIslandTop;
  const islandBot = bg.userData.bankIslandBot;
  const sandTopY  = SCENE_PARAMS.sandTopY;
  const bankIslH  = BANK_PARAMS.islandH;
  const BANK_ANGLE = Math.PI * 0.72;
  const COAST_R = 7.2;
  const BANK_DIST = COAST_R - 1.4;
  const bx = Math.cos(BANK_ANGLE) * BANK_DIST + BANK_PARAMS.posX;
  const bz = Math.sin(BANK_ANGLE) * BANK_DIST + BANK_PARAMS.posZ;
  const topY = sandTopY + bankIslH / 2 + BANK_PARAMS.height + BANK_PARAMS.posY;
  const botY = sandTopY - bankIslH * 0.3 + BANK_PARAMS.height + BANK_PARAMS.posY;
  if (islandTop) { islandTop.position.set(bx, topY, bz); }
  if (islandBot) { islandBot.position.set(bx, botY, bz); }
  if (bankModel) {
    const baseScale = bg.userData.bankBaseScale ?? 1;
    bankModel.scale.setScalar(baseScale * BANK_PARAMS.scale);
    bankModel.rotation.y = BANK_PARAMS.rotationY;
    bankModel.position.x = bx;
    bankModel.position.z = bz;
    if (islandTop) {
      const bb = new THREE.Box3().setFromObject(bankModel);
      bankModel.position.y = topY + bankIslH / 2 - bb.min.y;
    }
  }
}

// ─── Apply lighting params ────────────────────────────────────────────────────
function applyLightParams() {
  // Time of day: 0=dawn(east), 0.5=noon(overhead), 1=dusk(west)
  const tod = LIGHT_PARAMS.timeOfDay;
  const angle = tod * Math.PI; // 0 → π  (sun arc from east over top to west)
  const sunX =  Math.cos(angle) * 12;
  const sunY =  Math.max(1, Math.sin(angle) * 22);
  const sunZ =  6;
  sun.position.set(sunX, sunY, sunZ);
  // Sun color: warm dawn/dusk orange, white at noon
  const noon = new THREE.Color(1.0, 0.97, 0.90);
  const warm = new THREE.Color(1.0, 0.62, 0.22);
  const t2 = Math.abs(tod - 0.5) * 2; // 0 at noon, 1 at dawn/dusk
  sun.color.copy(noon).lerp(warm, t2 * t2);
  sun.intensity = LIGHT_PARAMS.sunIntensity * (1 - t2 * 0.35);
  // Ambient: cooler at dawn/dusk
  const ambNoon = new THREE.Color(0xd0e8f8);
  const ambWarm = new THREE.Color(0xf0c898);
  ambient.color.copy(ambNoon).lerp(ambWarm, t2 * 0.6);
  ambient.intensity = LIGHT_PARAMS.ambIntensity;
  fill.intensity = LIGHT_PARAMS.fillIntensity;
  renderer.toneMappingExposure = LIGHT_PARAMS.exposure * 0.38;
  scene.fog.density = LIGHT_PARAMS.fogDensity;
  bloom.strength = LIGHT_PARAMS.bloomStr;
  bloom.radius = LIGHT_PARAMS.bloomRadius;
  saturationPass.uniforms.uSaturation.value = LIGHT_PARAMS.saturation;
  saturationPass.uniforms.uBrightness.value = LIGHT_PARAMS.brightness;
  saturationPass.uniforms.uContrast.value   = LIGHT_PARAMS.contrast;
  saturationPass.uniforms.uHue.value        = LIGHT_PARAMS.hue;
  saturationPass.uniforms.uWarmth.value     = LIGHT_PARAMS.warmth;
}

function updateOutlinePasses(state) {
  if (!state) { _outlinePasses.forEach(o => { o.pass.selectedObjects = []; }); return; }
  const colorMap = {};
  _PIECE_COLORS.forEach(c => { colorMap[c] = []; });

  buildGroup.children.forEach(obj => {
    // Buildings
    const pid = obj.userData.buildingPlayerId;
    if (pid) {
      const p = state.players.find(pl => pl.id === pid);
      if (p && colorMap[p.color] !== undefined) colorMap[p.color].push(obj);
      return;
    }
    // Roads — matched by edgeId → road.playerId
    const eid = obj.userData.edgeId;
    if (eid !== undefined && state.board) {
      const edge = state.board.edges[eid];
      if (edge?.road) {
        const p = state.players.find(pl => pl.id === edge.road.playerId);
        if (p && colorMap[p.color] !== undefined) colorMap[p.color].push(obj);
      }
    }
  });

  _outlinePasses.forEach(o => { o.pass.selectedObjects = colorMap[o.color] || []; });
}

// ─── Building rendering ───────────────────────────────────────────────────────
function renderBuildings(state) {
  clearGroup(buildGroup);
  const { vertices, edges, hexes } = state.board;
  const robberHex = hexes[state.robberHex];

  vertices.forEach(v => {
    if (!v.building) return;
    const player = state.players.find(p => p.id === v.building.playerId);
    if (!player) return;
    const col = colorHex(player.color);
    const type = v.building.type;
    const baseY = HEX_H / 2;
    let mesh = cloneModel(type, col);
    if (mesh) {
      const box = new THREE.Box3().setFromObject(mesh);
      const size = new THREE.Vector3(); box.getSize(size);
      const targetH = type === 'settlement' ? 0.55 : SCENE_PARAMS.castleSize;
      const scale = targetH / (size.y || 1);
      mesh.scale.setScalar(scale);
      const posY = type === 'settlement' ? SCENE_PARAMS.settlementY : SCENE_PARAMS.castleY;
      mesh.position.set(v.x, baseY + posY, v.z);
    } else {
      mesh = type === 'settlement' ? makeSettlement(col) : makeCity(col);
      const posY = type === 'settlement' ? SCENE_PARAMS.settlementY : SCENE_PARAMS.castleY;
      mesh.position.set(v.x, baseY + posY, v.z);
    }
    mesh.userData.buildingType = type;
    mesh.userData.buildingPlayerId = v.building.playerId;
    mesh.userData.baseScale = mesh.scale.x;
    mesh.userData.vertexId = v.id;
    mesh.renderOrder = 2; // renders on top of roads (renderOrder 1)
    mesh.traverse(c => {
      c.userData.buildingType = type;
      c.userData.buildingPlayerId = v.building.playerId;
      c.userData.vertexId = v.id;
      c.renderOrder = 2;
    });
    buildGroup.add(mesh);
  });

  edges.forEach(e => {
    if (!e.road) return;
    const player = state.players.find(p => p.id === e.road.playerId);
    if (!player) return;
    const v1 = vertices[e.vertices[0]], v2 = vertices[e.vertices[1]];
    const col = colorHex(player.color);
    const roadY = HEX_H / 2 + SCENE_PARAMS.roadY;
    let road = cloneModel('road', col);
    if (road) {
      const dx = v2.x-v1.x, dz = v2.z-v1.z;
      const len = Math.sqrt(dx*dx+dz*dz);
      const box = new THREE.Box3().setFromObject(road);
      const size = new THREE.Vector3(); box.getSize(size);
      road.scale.set(len / (size.x || 1), 0.5 / (size.y || 1), 0.5 / (size.z || 1));
      road.position.set((v1.x+v2.x)/2, roadY, (v1.z+v2.z)/2);
      road.rotation.y = Math.atan2(-dz, dx);
    } else {
      road = makeRoad(v1, v2, col, roadY);
    }
    road.userData.edgeId = e.id;
    road.renderOrder = 1;
    road.traverse(c => { c.userData.edgeId = e.id; c.renderOrder = 1; });
    buildGroup.add(road);
  });

  // Cache my settlement meshes for the pulse animation in animate()
  _mySettlements = buildGroup.children.filter(
    m => m.userData.buildingType === 'settlement' && m.userData.buildingPlayerId === myId
  );

  updateOutlinePasses(state);

  // Robber lives in robberGroup (persists across renderBuildings for movement animation)
  // Only rebuild when not mid-movement
  const newHexId = state.robberHex;
  const hexChanged = robberLastHexId !== null && robberLastHexId !== newHexId && robberHex;

  if (!robberMove.active) {
    // Full rebuild of robber mesh
    clearGroup(robberGroup);
    robberAnim.mixer = null;
    robberAnim.mesh = null;
    robberAnim.actions = {};
    robberAnim.currentAction = null;
    robberAnim.lastActive = null;
    robberAnim.active = (state.status === 'robber');

    if (robberHex) {
      let robberMesh;
      const gltf = GLTF_DATA['robber'];

      if (gltf) {
        robberMesh = gltf.scene;
        robberMesh.traverse(c => { if (c.isMesh) c.castShadow = true; });
        robberMesh.scale.set(1, 1, 1);
        robberMesh.position.set(0, 0, 0);
        const box = new THREE.Box3().setFromObject(robberMesh);
        const size = new THREE.Vector3(); box.getSize(size);
        // Clamp size.y — quantized/optimized GLBs can report tiny extents
        const sizeY = Math.max(size.y, 0.25);
        robberMesh.scale.setScalar((0.34 / sizeY) * ROBBER_PARAMS.scale);
        // Apply material overrides
        robberMesh.traverse(c => {
          if (!c.isMesh || !c.material) return;
          c.renderOrder = 2;
          c.material.depthTest = true;
          c.material.emissiveIntensity = ROBBER_PARAMS.emissive;
          if (!c.material.emissive) c.material.emissive = new THREE.Color(0xffffff);
          if (ROBBER_PARAMS.roughness >= 0) c.material.roughness = ROBBER_PARAMS.roughness;
          if (ROBBER_PARAMS.metalness >= 0) c.material.metalness = ROBBER_PARAMS.metalness;
          c.material.needsUpdate = true;
        });

        if (gltf.animations?.length) {
          const mixer = new THREE.AnimationMixer(robberMesh);
          mixer.timeScale = ROBBER_PARAMS.animSpeed;
          const actions = {};
          gltf.animations.forEach(clip => {
            const a = mixer.clipAction(clip); a.loop = THREE.LoopRepeat; actions[clip.name] = a;
          });
          robberAnim.mixer = mixer; robberAnim.actions = actions;
          // Default: stay still — no animation until clicked
          robberAnim.triggered = false;
        }
      } else {
        robberMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.17, 0.52, 8),
          new THREE.MeshStandardMaterial({ color:0x111111, roughness:0.7 })
        );
        robberMesh.castShadow = true;
      }

      robberMesh.position.set(0, 0, 0);
      const robberBox = new THREE.Box3().setFromObject(robberMesh);
      // Desert has no number token — use wheat tile height as reference so robber sits at same level
      const robberRefType = robberHex.type === 'desert' ? 'fields' : robberHex.type;
      const numYOff = NUMBER_Y_OFFSET[robberRefType] ?? 0;
      const tokenTop = robberHex.number
        ? tileTopY(robberRefType) + 0.025 + numYOff + 0.02
        : tileTopY(robberRefType);
      const groundY = tokenTop - robberBox.min.y;
      robberMesh.position.set(robberHex.x, groundY, robberHex.z);
      robberAnim.mesh  = robberMesh;
      robberAnim.baseY = groundY;
      robberAnim.cycleTimer = 0;

      if (robberAnim.active) {
        const ringGeo = new THREE.RingGeometry(0.22, 0.3, 20);
        const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color:0xff3322, transparent:true, opacity:0.7, side:THREE.DoubleSide }));
        ring.rotation.x = -Math.PI/2;
        ring.position.set(robberHex.x, tileTopY(robberHex.type) + 0.01, robberHex.z);
        robberGroup.add(ring);
      }
      robberGroup.add(robberMesh);
      // Keep hidden if intro hasn't started the drop yet
      if (tileIntro.active || tokenIntro.active || (!robberDropIntro.active && !tokenIntro.done)) {
        robberMesh.visible = false;
      }
    }
  }

  // Detect hex change → start arc movement animation
  if (hexChanged && robberAnim.mesh && robberHex) {
    const startPos = robberAnim.mesh.position;
    const _rRefType = robberHex.type === 'desert' ? 'desert' : robberHex.type;
    const _rNumYOff = NUMBER_Y_OFFSET[_rRefType] ?? 0;
    const endGroundY = robberHex.number
      ? tileTopY(_rRefType) + 0.025 + _rNumYOff + 0.02 - (robberAnim.mesh ? new THREE.Box3().setFromObject(robberAnim.mesh).min.y : 0)
      : tileTopY(_rRefType) - (robberAnim.mesh ? new THREE.Box3().setFromObject(robberAnim.mesh).min.y : 0);
    robberMove.startX = startPos.x; robberMove.startZ = startPos.z;
    robberMove.endX = robberHex.x; robberMove.endZ = robberHex.z; robberMove.endY = endGroundY;
    robberMove.t = 0; robberMove.active = true;
    robberAnim.active = true; robberAnim.lastActive = null; // trigger moving clips
    playRobberVO();
  }
  robberLastHexId = newHexId;
}

function makeSettlement(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness:0.65, metalness:0.05 });
  const darkMat = new THREE.MeshStandardMaterial({ color:0x222233, roughness:0.7 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.3,0.24,0.3), mat);
  body.position.y = 0.12; body.castShadow = true; g.add(body);
  const roofGeo = new THREE.ConeGeometry(0.245, 0.22, 4);
  roofGeo.rotateY(Math.PI/4);
  const roof = new THREE.Mesh(roofGeo, darkMat);
  roof.position.y = 0.35; roof.castShadow = true; g.add(roof);
  // tiny window
  const winMat = new THREE.MeshStandardMaterial({ color:0xffeeaa, roughness:0.3, metalness:0, emissive:0xffcc44, emissiveIntensity:0.3 });
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.07,0.07,0.01), winMat);
  win.position.set(0,0.12,0.151); g.add(win);
  return g;
}

function makeCity(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness:0.6, metalness:0.05 });
  const darkMat = new THREE.MeshStandardMaterial({ color:0x222233, roughness:0.7 });
  const winMat = new THREE.MeshStandardMaterial({ color:0xffeeaa, emissive:0xffcc44, emissiveIntensity:0.5, roughness:0.3, metalness:0 });

  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.24,0.46,0.24), mat);
  tower.position.set(-0.13,0.23,0); tower.castShadow=true; g.add(tower);

  const side = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.24,0.22), mat);
  side.position.set(0.15,0.12,0); side.castShadow=true; g.add(side);

  const battlements = new THREE.Mesh(new THREE.BoxGeometry(0.26,0.09,0.26), darkMat);
  battlements.position.set(-0.13,0.5,0); g.add(battlements);

  const sideRoof = new THREE.Mesh((() => { const rg=new THREE.ConeGeometry(0.19,0.18,4); rg.rotateY(Math.PI/4); return rg; })(), darkMat);
  sideRoof.position.set(0.15,0.33,0); g.add(sideRoof);

  const win1 = new THREE.Mesh(new THREE.BoxGeometry(0.07,0.09,0.01), winMat);
  win1.position.set(-0.13,0.23,0.121); g.add(win1);
  const win2 = new THREE.Mesh(new THREE.BoxGeometry(0.07,0.07,0.01), winMat);
  win2.position.set(0.15,0.12,0.111); g.add(win2);
  return g;
}

function makeRoad(v1, v2, color, roadY) {
  const dx=v2.x-v1.x, dz=v2.z-v1.z;
  const len = Math.sqrt(dx*dx+dz*dz);
  const geo = new THREE.BoxGeometry(len*0.88, 0.08, 0.18);
  const mat = new THREE.MeshStandardMaterial({ color, map: cobbleTex, roughness:0.85, metalness:0.02 });
  const m = new THREE.Mesh(geo, mat);
  const y = roadY ?? (HEX_H / 2 + 0.05);
  m.position.set((v1.x+v2.x)/2, y, (v1.z+v2.z)/2);
  m.rotation.y = Math.atan2(-dz, dx);
  m.castShadow = true;
  return m;
}

// ─── Placement markers ────────────────────────────────────────────────────────
function tileTopY(hexType) {
  const mult = TILE_HEIGHT_MULT[hexType] ?? 1.0;
  const yOff = TILE_Y_OFFSET[hexType] ?? 0;
  return MODELS[`hex_${hexType}`] ? -HEX_H / 2 - TILE_SINK + HEX_H * mult + yOff : HEX_H / 2 + yOff;
}

function showVertexMarkers(ids, append = false) {
  if (!append) clearGroup(markerGroup);
  if (!gameState) return;

  // Hide all markers during tile intro (or while intro is pending model load)
  const hideDuringIntro = tileIntro.active || _pendingIntroHexes !== null;
  if (hideDuringIntro) markerGroup.userData.pendingAppear = true;

  ids.forEach(vid => {
    const v = gameState.board.vertices[vid];
    const maxTop = HEX_H / 2;
    const geo = new THREE.SphereGeometry(0.09, 8, 8);
    const mat = new THREE.MeshStandardMaterial({ color:0xc8921a, roughnessMap:tokenScratchTex(), roughness:0.72, metalness:0.82, envMapIntensity:1.6, emissive:0xc8600a, emissiveIntensity:0.18, transparent: hideDuringIntro, opacity: hideDuringIntro ? 0 : 1 });
    const m = new THREE.Mesh(geo, mat);
    m.userData = { type:'vertexMarker', vertexId:vid, markerType:'vertex', baseY: maxTop + 0.17 };
    const startYOff = hideDuringIntro ? -2.5 : 0;
    m.position.set(v.x, maxTop + 0.17 + SCENE_PARAMS.vertexMarkerY + startYOff, v.z);
    markerGroup.add(m);
  });
}

function showEdgeMarkers(ids, append = false) {
  if (!append) clearGroup(markerGroup);
  if (!gameState) return;
  ids.forEach(eid => {
    const e = gameState.board.edges[eid];
    const v1 = gameState.board.vertices[e.vertices[0]];
    const v2 = gameState.board.vertices[e.vertices[1]];
    const dx=v2.x-v1.x, dz=v2.z-v1.z;
    const len = Math.sqrt(dx*dx+dz*dz);
    const geo = new THREE.BoxGeometry(len*0.62, 0.1, 0.2);
    const mat = new THREE.MeshStandardMaterial({ color:0xc8921a, roughnessMap:tokenScratchTex(), roughness:0.72, metalness:0.82, envMapIntensity:1.6, emissive:0xc8600a, emissiveIntensity:0.18 });
    const m = new THREE.Mesh(geo, mat);
    const edgeBaseY = HEX_H/2 + 0.06;
    m.userData = { type:'edgeMarker', edgeId:eid, markerType:'edge', baseY: edgeBaseY };
    m.position.set((v1.x+v2.x)/2, edgeBaseY + SCENE_PARAMS.edgeMarkerY, (v1.z+v2.z)/2);
    m.rotation.y = Math.atan2(-dz, dx);
    // Golden bloom — flat plane along edge with additive blending (camera-agnostic bloom look)
    const glowGeo = new THREE.PlaneGeometry(len * 0.85, 0.55);
    const glowMat = new THREE.MeshBasicMaterial({ map: markerGlowTex(), color: 0xffd060, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = -Math.PI / 2; // lay flat along the edge
    glow.userData = { markerGlow: true };
    m.add(glow);
    markerGroup.add(m);
  });
  // Refresh edge marker cache after adding
  _edgeMarkerMeshes = markerGroup.children.filter(m => m.userData.markerType === 'edge');
}

function showHexMarkers(ids) {
  clearGroup(markerGroup);
  if (!gameState) return;
  ids.forEach(hid => {
    const h = gameState.board.hexes[hid];
    const geo = new THREE.CylinderGeometry(HEX_R*0.62, HEX_R*0.62, 0.07, 6);
    geo.rotateY(Math.PI/6);
    const mat = new THREE.MeshStandardMaterial({ color:0xff3300, emissive:0xff2200, emissiveIntensity:0.25, transparent:true, opacity:0.28 });
    const m = new THREE.Mesh(geo, mat);
    const hexBaseY = HEX_H/2 + 0.04;
    m.userData = { type:'hexMarker', hexId:hid, markerType:'hex', baseY: hexBaseY };
    m.position.set(h.x, hexBaseY + SCENE_PARAMS.hexMarkerY, h.z);
    markerGroup.add(m);
  });
}

function refreshPassiveMarkers() {
  clearGroup(markerGroup);
  if (!gameState) return;
  if (_canAffordSettle && gameState.diceRolled)
    showVertexMarkers(validSettlementVertices(gameState, myId, false), true);
  if (_canAffordRoad && gameState.diceRolled)
    showEdgeMarkers(validRoadEdges(gameState, myId, false, null), true);
}

// ─── Valid move helpers ───────────────────────────────────────────────────────
function validSettlementVertices(state, pid, setup) {
  return state.board.vertices.filter(v => {
    if (v.building) return false;
    const tooClose = v.adjacentEdges.some(eid => {
      const nid = state.board.edges[eid].vertices.find(x => x !== v.id);
      return state.board.vertices[nid].building !== null;
    });
    if (tooClose) return false;
    if (setup) return true;
    return v.adjacentEdges.some(eid => state.board.edges[eid].road?.playerId === pid);
  }).map(v => v.id);
}
function validCityVertices(state, pid) {
  return state.board.vertices.filter(v => v.building?.playerId===pid && v.building?.type==='settlement').map(v=>v.id);
}
function validRoadEdges(state, pid, setup, lastS) {
  return state.board.edges.filter(e => {
    if (e.road) return false;
    if (setup) return e.vertices.includes(lastS);
    return e.vertices.some(vid => {
      const v = state.board.vertices[vid];
      if (v.building?.playerId === pid) return true;
      const noEnemy = !v.building || v.building.playerId === pid;
      return noEnemy && v.adjacentEdges.some(eid => eid!==e.id && state.board.edges[eid].road?.playerId===pid);
    });
  }).map(e=>e.id);
}
function validRobberHexes(state) { return state.board.hexes.filter(h=>h.id!==state.robberHex).map(h=>h.id); }

// ─── Build mode ───────────────────────────────────────────────────────────────
function enterBuildMode(mode) {
  if (!gameState) return;
  buildMode = mode;
  passiveRoadMarkers   = false;
  passiveVertexMarkers = false;
  const s = gameState;
  const isSetup = s.status==='setup_forward'||s.status==='setup_backward';

  if (mode==='settlement')     showVertexMarkers(validSettlementVertices(s, myId, isSetup));
  else if (mode==='city')      showVertexMarkers(validCityVertices(s, myId));
  else if (mode==='road')      showEdgeMarkers(validRoadEdges(s, myId, isSetup, isSetup?s.lastSettlementPlaced:null));
  else if (mode==='robber')    showHexMarkers(validRobberHexes(s));

  document.getElementById('buildMode').style.display='block';
  document.getElementById('buildMode').innerHTML =
    mode==='settlement' ? '<img src="Icons/Tower Icon.png" class="piece-icon" alt="tower"> Click a yellow spot to place tower' :
    mode==='city'       ? '<img src="Icons/Castle Icon.png" class="piece-icon" alt="castle"> Click a yellow spot to upgrade to castle' :
    mode==='road'       ? '<img src="images/Road icon.png" class="piece-icon" alt="road"> Click a yellow edge to place road' :
                          '💀 Click a tile to move the robber';
  document.getElementById('btnCancel').style.display='block';
}

function exitBuildMode(reapplyPassive = true) {
  buildMode = null;
  passiveRoadMarkers   = false;
  passiveVertexMarkers = false;
  clearGroup(markerGroup);
  document.getElementById('buildMode').style.display='none';
  document.getElementById('btnCancel').style.display='none';
  hideBuildConfirm();
  // Re-apply passive markers if still applicable (skip after successful build — server will update)
  if (reapplyPassive) {
    const anyPassive = (_canAffordRoad || _canAffordSettle) && gameState?.diceRolled;
    if (anyPassive) {
      passiveRoadMarkers   = _canAffordRoad;
      passiveVertexMarkers = _canAffordSettle;
      refreshPassiveMarkers();
    }
  }
}

// ─── Touch support ─────────────────────────────────────────────────────────────
let _touchStart = null;
let _touchStartTime = 0;

renderer.domElement.addEventListener('touchstart', e => {
  if (e.touches.length === 1) {
    _touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    _touchStartTime = Date.now();
  } else {
    _touchStart = null; // multi-touch = pinch, not a tap
  }
}, { passive: true });

renderer.domElement.addEventListener('touchend', e => {
  if (!_touchStart || e.changedTouches.length !== 1) return;
  const dx = e.changedTouches[0].clientX - _touchStart.x;
  const dy = e.changedTouches[0].clientY - _touchStart.y;
  const dt = Date.now() - _touchStartTime;
  if (Math.sqrt(dx*dx + dy*dy) < 12 && dt < 350) {
    // Tap — fire a synthetic click so raycasting handlers run
    const touch = e.changedTouches[0];
    renderer.domElement.dispatchEvent(new MouseEvent('click', {
      clientX: touch.clientX, clientY: touch.clientY, bubbles: true
    }));
  }
  _touchStart = null;
}, { passive: true });

// ─── Raycaster / click ────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(-9999,-9999);

// Build confirm state
let pendingBuildAction = null;
let pendingMarkerMesh = null;

function showBuildConfirm(label, onConfirm, markerMesh, btnLabel) {
  pendingBuildAction = onConfirm;
  pendingMarkerMesh = markerMesh ?? null;
  document.getElementById('buildConfirmMsg').textContent = label;
  document.getElementById('btnBuildConfirmYes').textContent = btnLabel ?? 'Build';
  document.getElementById('btnBuildConfirmYes').disabled = !onConfirm;
  document.getElementById('buildConfirm').style.display = 'flex';
}
function hideBuildConfirm() {
  pendingBuildAction = null;
  if (pendingMarkerMesh) { pendingMarkerMesh.scale.setScalar(1); pendingMarkerMesh = null; }
  document.getElementById('buildConfirm').style.display = 'none';
}
document.getElementById('btnBuildConfirmYes').addEventListener('click', () => {
  if (pendingBuildAction) pendingBuildAction();
  hideBuildConfirm();
  exitBuildMode(false); // skip passive re-apply; server will send updated state
});
document.getElementById('btnBuildConfirmNo').addEventListener('click', () => {
  hideBuildConfirm();
});

renderer.domElement.addEventListener('click', e => {
  if (!gameState) return;
  const hasPassive = passiveVertexMarkers || passiveRoadMarkers;
  if (!buildMode && !hasPassive) return;
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX-rect.left)/rect.width)*2-1;
  mouse.y = -((e.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(markerGroup.children, true);
  if (!hits.length) return;

  const ud = hits[0].object.userData?.type ? hits[0].object.userData : hits[0].object.parent?.userData;
  if (!ud) return;

  const hitMesh = hits[0].object;
  if (ud.type==='vertexMarker') {
    // passive click — enter settlement build mode for this vertex
    if (!buildMode) {
      const vid = ud.vertexId;
      passiveVertexMarkers = false;
      passiveRoadMarkers   = false;
      buildMode = 'settlement';
      document.getElementById('buildMode').style.display = 'block';
      document.getElementById('buildMode').innerHTML = '<img src="Icons/Tower Icon.png" class="piece-icon" alt="tower"> Click a yellow spot to place tower';
      document.getElementById('btnCancel').style.display = 'block';
      showBuildConfirm('Place tower here?', () => {
        socket.emit('placeSettlement', { vertexId: vid }); addTimerBonus(15);
      }, hitMesh);
      return;
    }
    const capturedMode = buildMode;
    const label = capturedMode==='settlement' ? 'Place tower here?' : 'Upgrade to castle?';
    const vid = ud.vertexId;
    showBuildConfirm(label, () => {
      if (capturedMode==='settlement') { socket.emit('placeSettlement',{vertexId:vid}); addTimerBonus(15); }
      else if (capturedMode==='city')  { socket.emit('buildCity',{vertexId:vid}); addTimerBonus(15); }
    }, hitMesh);
  } else if (ud.type==='edgeMarker') {
    const eid = ud.edgeId;
    showBuildConfirm('Build road here?', () => {
      socket.emit('placeRoad',{edgeId:eid}); addTimerBonus(15);
    }, hitMesh);
  } else if (ud.type==='hexMarker') {
    const h = gameState.board.hexes[ud.hexId];
    const victims = gameState.players.filter(p => {
      if (p.id===myId) return false;
      return gameState.board.vertices.some(v=>v.adjacentHexes.includes(h.id)&&v.building?.playerId===p.id);
    });
    const hid = ud.hexId;
    const doRobber = (stealFrom) => {
      exitBuildMode();
      addTimerBonus(15);
      socket.emit('moveRobber', { hexId: hid, stealFrom });
    };
    if (victims.length <= 1) {
      const steal = victims.length ? victims[0].id : null;
      showBuildConfirm('Move robber here?', () => doRobber(steal), hitMesh, 'Place Robber');
    } else {
      showStealPicker(victims, doRobber, hitMesh);
    }
  }
});

renderer.domElement.addEventListener('mousemove', e => {
  if (!buildMode || markerGroup.userData.pendingAppear) return;
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX-rect.left)/rect.width)*2-1;
  mouse.y = -((e.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(markerGroup.children, true);
  markerGroup.children.forEach(m => { if(m.material){m.material.opacity=0.75; m.scale.setScalar(1);} });
  if (hits.length) { hits[0].object.material&&(hits[0].object.material.opacity=1); hits[0].object.scale.setScalar(1.3); }
});

// Click on robber mesh to trigger a one-shot animation
renderer.domElement.addEventListener('click', e => {
  if (!robberAnim.mesh || !robberAnim.mixer || robberAnim.active) return;
  const rect = canvas.getBoundingClientRect();
  const mx = ((e.clientX-rect.left)/rect.width)*2-1;
  const my = -((e.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera({x:mx,y:my}, camera);
  const hits = raycaster.intersectObjects(robberGroup.children, true);
  if (!hits.length) return;
  const allClips = Object.values(robberAnim.actions);
  if (!allClips.length) return;
  const clip = allClips[Math.floor(Math.random() * allClips.length)];
  if (robberAnim.currentAction) robberAnim.currentAction.stop();
  clip.reset(); clip.loop = THREE.LoopOnce; clip.clampWhenFinished = true; clip.play();
  robberAnim.currentAction = clip;
  robberAnim.triggered = true;
  robberAnim.mixer.addEventListener('finished', function onFinish() {
    robberAnim.mixer.removeEventListener('finished', onFinish);
    clip.stop();
    robberAnim.currentAction = null;
    robberAnim.triggered = false;
  });
});

// Click on a settlement to show upgrade option
renderer.domElement.addEventListener('click', e => {
  if (!gameState || buildMode) return;
  const myTurn = gameState.players[gameState.currentPlayerIndex]?.id === myId;
  if (!myTurn || !gameState.diceRolled) return;
  const rect = canvas.getBoundingClientRect();
  const mx = ((e.clientX-rect.left)/rect.width)*2-1;
  const my = -((e.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(new THREE.Vector2(mx, my), camera);
  const hits = raycaster.intersectObjects(buildGroup.children, true);
  if (!hits.length) return;
  const hit = hits[0].object;
  if (hit.userData.buildingType !== 'settlement' || hit.userData.buildingPlayerId !== myId) return;
  const vid = hit.userData.vertexId;
  const canAfford = COSTS.city && Object.entries(COSTS.city).every(([r,n]) => (gameState.players.find(p=>p.id===myId)?.resources[r]??0) >= n);
  const costStr = '🌾🌾 + 🪨🪨🪨';
  const msg = canAfford ? `Upgrade to castle? (${costStr})` : `Need ${costStr} to upgrade to castle`;
  showBuildConfirm(msg, canAfford ? () => { _vikingHorn.currentTime = 0; _vikingHorn.volume = sfxVol(); _vikingHorn.play().catch(() => {}); socket.emit('buildCity', { vertexId: vid }); addTimerBonus(15); } : null);
  if (!canAfford) {
    // Show message only — disable the confirm button
    document.getElementById('btnBuildConfirmYes').disabled = true;
  }
});

// ─── UI ───────────────────────────────────────────────────────────────────────
const RES_INFO = {
  wood:  { icon:'🪵', label:'Wood'  },
  sheep: { icon:'🐑', label:'Sheep' },
  wheat: { icon:'🌾', label:'Wheat' },
  brick: { icon:'🧱', label:'Brick' },
  ore:   { icon:'🪨',  label:'Ore'   },
};
const COSTS = { settlement:{wood:1,brick:1,sheep:1,wheat:1}, road:{wood:1,brick:1}, city:{wheat:2,ore:3}, devCard:{ore:1,wheat:1,sheep:1} };

const ROBBER_VO = [
  'Ej hekje leire.mp3',
  'å så sett du den på mej.mp3',
  'du kan ikkje meine ditta.mp3',
  'e det mulig.mp3',
  'ej gidd ikkje meir.mp3',
  'embargo.mp3',
  'hallo gjeng an å bruke haude.mp3',
  'kor dum gjeng det an å bli.mp3',
  'sett han der du.mp3',
  'skjerpe dej laurits.mp3',
  'ødelagt klokke.mp3',
  'buldre da.mp3',
  'det forandrer sagen.mp3',
  'ditta skal ej huske på.mp3',
  'du kan ikkje meine ditta.mp3',
  'en gang til så blir det embargo.mp3',
  'live skal bli mor.mp3',
  'mango chuckney kyllingwok.mp3',
  'no klikka det snart.mp3',
  'om det ikkje va embargo før.mp3',
  'siste gangen ej spela med doke.mp3',
  'sparke en død hest.mp3',
  'snakk om å sparke en død hest.mp3',
  'stikk heim he tidligvakt.mp3',
  'vinterdekk på opelen.mp3',
  'ggs for lenge sia.mp3',
];
function playRobberVO() {
  const clip = ROBBER_VO[Math.floor(Math.random() * ROBBER_VO.length)];
  const a = new Audio('voice over/' + clip);
  a.volume = voVol();
  a.play().catch(() => {});
}
const PLAYER_CSS = ['#e74c3c','#3498db','#ffffff','#2ecc71'];

// Turn timer
let timerInterval = null;
let timerEnd = 0;
let timerMax = 90;   // tracks the max for the current turn (resets on new turn, grows with +15s bonuses)
let lastTurnPlayer = null;

function startTurnTimer(durationSec = 90) {
  clearInterval(timerInterval);
  timerMax = durationSec;
  timerEnd = Date.now() + durationSec * 1000;
  timerInterval = setInterval(updateTimerDisplay, 250);
}

function addTimerBonus(sec = 15) {
  timerEnd = Math.min(timerEnd + sec * 1000, Date.now() + 90 * 1000); // cap bonus at 90s from now
  timerMax = Math.max(timerMax, Math.ceil((timerEnd - Date.now()) / 1000));
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const remaining = Math.max(0, timerEnd - Date.now());
  const sec = Math.ceil(remaining / 1000);
  const m = Math.floor(sec / 60), s = sec % 60;
  const el = document.getElementById('turnTimer');
  const fill = document.getElementById('turnTimerFill');
  if (el) {
    el.textContent = `${m}:${s.toString().padStart(2,'0')}`;
    if (sec <= 20) { el.classList.add('timer-urgent'); }
    else { el.classList.remove('timer-urgent'); }
  }
  if (fill) {
    const pct = timerMax > 0 ? (remaining / (timerMax * 1000)) * 100 : 0;
    fill.style.width = pct + '%';
    fill.style.background = sec <= 20 ? '#e74c3c' : sec <= 45 ? '#f39c12' : '#3498db';
  }
  if (remaining === 0) {
    clearInterval(timerInterval);
    timerInterval = null;
    if (gameState) {
      const curr = gameState.players[gameState.currentPlayerIndex];
      // All clients emit — server validates elapsed time server-side to prevent abuse
      socket.emit('forceEndTurn');
    }
  }
}

function updateUI(state) {
  const me = state.players.find(p=>p.id===myId);
  const curr = state.players[state.currentPlayerIndex];
  const isMyTurn = curr?.id===myId;
  const isSetup = state.status==='setup_forward'||state.status==='setup_backward';
  const isRobber = state.status==='robber';
  const isPlaying = state.status==='playing';

  // Restart timer when turn changes
  if (curr?.id !== lastTurnPlayer) { lastTurnPlayer = curr?.id; startTurnTimer(90); }

  // Auto-roll countdown: start when it becomes our turn to roll, stop otherwise
  const needsRoll = isMyTurn && isPlaying && !state.diceRolled;
  if (!needsRoll) _rollPending = false; // server confirmed roll (or turn changed)
  if (needsRoll && _autoRollStart === null && !_rollPending) {
    startAutoRoll();
  } else if (!needsRoll && _autoRollStart !== null) {
    stopAutoRoll();
  }

  updateMainAction(state, isMyTurn, isSetup, isRobber, isPlaying, me);
  updateBank(state);
  updateMobileBank(state);
  updatePlayersList(state);
  updateMobilePlayerCards(state);
  updateSelfPlayer(state, me);
  updatePieces(state, me);
  updateTradeIncoming(state);
  updateTradePendingUI();
  syncLog(state);

  // Dice display
  const dd = document.getElementById('diceDisplay');
  if (dd) dd.textContent = state.dice ? `🎲 ${state.dice[0]}+${state.dice[1]}=${state.dice[0]+state.dice[1]}` : '';

  // Build shortcut enable/disable
  const res = me?.resources||{};
  const afford = c => Object.entries(c).every(([r,n])=>(res[r]||0)>=n);
  const setEnabled = (id, on) => { const b=document.getElementById(id); if(b) b.disabled=!on; };

  if (isSetup && isMyTurn) {
    setEnabled('btnSettle',false); setEnabled('btnRoad',false); setEnabled('btnCity',false);
    if (!buildMode) { if(state.setupPhase==='settlement') enterBuildMode('settlement'); else if(state.setupPhase==='road') enterBuildMode('road'); }
  } else if (isRobber && state.robbingPlayer===myId) {
    setEnabled('btnSettle',false); setEnabled('btnRoad',false); setEnabled('btnCity',false);
    if (!buildMode) { enterBuildMode('robber'); }
  } else {
    setEnabled('btnSettle', isMyTurn&&isPlaying&&state.diceRolled&&afford(COSTS.settlement));
    const hasFreeRoads = (me?.freeRoads||0) > 0;
    setEnabled('btnRoad',   isMyTurn&&isPlaying&&(state.diceRolled||hasFreeRoads)&&(afford(COSTS.road)||hasFreeRoads));
    setEnabled('btnCity',   isMyTurn&&isPlaying&&state.diceRolled&&afford(COSTS.city));
    // Auto-enter road build mode when free roads are available and not yet in build mode
    if (isMyTurn && isPlaying && hasFreeRoads && buildMode !== 'road') enterBuildMode('road');
  }

  _canAffordCity   = isMyTurn && isPlaying && afford(COSTS.city);
  _canAffordRoad   = isMyTurn && isPlaying && afford(COSTS.road);
  _canAffordSettle = isMyTurn && isPlaying && afford(COSTS.settlement);

  // Passively show vertex+edge markers when player can afford settlement/road and not in build mode
  if (!buildMode) {
    const wantV = _canAffordSettle && state.diceRolled;
    const wantE = _canAffordRoad   && state.diceRolled;
    passiveVertexMarkers = wantV;
    passiveRoadMarkers   = wantE;
    if (wantV || wantE) refreshPassiveMarkers();
    else clearGroup(markerGroup);
  }
  const hasPlayable = (me?.devCards||[]).some(c=>!c.played&&!c.newThisTurn&&c.type!=='vp'&&c.type!=='hidden');
  setEnabled('btnDevBuy',  isMyTurn&&isPlaying&&state.diceRolled&&afford(COSTS.devCard));
  // Dev cards can be played before OR after rolling, but not during robber placement
  setEnabled('btnDevPlay', isMyTurn&&isPlaying&&hasPlayable&&!state.devCardPlayed);
  updateMyResourcesHand(state, me);
  updateTradePanelIfOpen();
}

function updateMainAction(state, isMyTurn, isSetup, isRobber, isPlaying, me) {
  const btn = document.getElementById('mainActionBtn');
  if (!btn) return;
  const curr = state.players[state.currentPlayerIndex];

  // Avatar color + content
  const av = document.getElementById('actionAvatar');
  if (av && curr) {
    av.style.background = curr.color;
    av.textContent = curr.isBot ? '🤖' : curr.name[0].toUpperCase();
  }

  if (!isMyTurn) {
    btn.textContent = `${curr?.name}'s turn`;
    btn.style.background = curr?.color || '#555';
    btn.disabled = true;
    return;
  }

  btn.disabled = false;
  btn.style.fontSize = '';
  btn.style.letterSpacing = '';
  if (isSetup) {
    const phase = state.setupPhase;
    btn.textContent = phase==='settlement' ? 'Place Tower' : 'Place Road';
    btn.style.background = '#27ae60';
    btn.onclick = () => enterBuildMode(phase);
  } else if (isRobber && state.robbingPlayer===myId) {
    btn.textContent = 'Move Robber';
    btn.style.background = '#8e44ad';
    btn.onclick = () => enterBuildMode('robber');
  } else if (isPlaying && !state.diceRolled && (me?.freeRoads||0) > 0) {
    btn.textContent = `🛣 Place Road (${me.freeRoads} free)`;
    btn.style.background = '#8e44ad';
    btn.onclick = () => enterBuildMode('road');
  } else if (isPlaying && !state.diceRolled) {
    btn.textContent = '🎲';
    btn.style.background = '#e74c3c';
    btn.style.fontSize = '2.2rem';
    btn.style.letterSpacing = '0';
    btn.onclick = () => { stopAutoRoll(); _rollPending = true; socket.emit('rollDice'); addTimerBonus(15); };
  } else if (isPlaying && state.diceRolled) {
    const fr = me?.freeRoads||0;
    if (fr > 0) {
      btn.textContent = `🛣 Place Road (${fr} free)`;
      btn.style.background = '#8e44ad';
      btn.onclick = () => enterBuildMode('road');
    } else {
      btn.textContent = 'End Turn';
      btn.style.background = '#2980b9';
      btn.onclick = () => {
        exitBuildMode();
        const s = new Audio('sound effects/Marcello Del Monaco - Sci Craft Game - Menu Button.aac');
        s.volume = sfxVol(); s.play().catch(() => {});
        socket.emit('endTurn');
      };
    }
  } else {
    btn.textContent = '—';
    btn.style.background = '#555';
    btn.disabled = true;
  }
}

// Returns 'dark' if color is light enough to need dark text
function colorTextClass(hexColor) {
  const c = hexColor.replace('#','');
  const r = parseInt(c.slice(0,2),16), g = parseInt(c.slice(2,4),16), b = parseInt(c.slice(4,6),16);
  const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
  return lum > 0.65 ? 'dark-text' : '';
}

function updateMobileBank(state) {
  const el = document.getElementById('mobileBankBar');
  if (!el) return;
  const buildHtml = (r, icon) => {
    let count = '?', low = false;
    if (state.bankStockTiers) {
      const tier = state.bankStockTiers[r] ?? 0;
      count = tier === 0 ? '✕' : tier === 1 ? '≤8' : tier === 2 ? '≤14' : '15+';
      low = tier <= 1;
    } else if (state.bankStock) {
      count = state.bankStock[r] ?? 0;
      low = count <= 3;
    }
    return `<div class="bank-chip${low?' bank-chip-low':''}"><span class="bc-icon">${icon}</span><span class="bc-count">${count}</span></div>`;
  };
  el.innerHTML = Object.entries(RES_INFO).map(([r,{icon}]) => buildHtml(r, icon)).join('');
}

function updateMobilePlayerCards(state) {
  const el = document.getElementById('mobilePlayerCardsInner');
  if (!el) return;
  el.innerHTML = '';
  state.players.forEach((p, i) => {
    const isActive = i === state.currentPlayerIndex;
    const isSelf = p.id === myId;
    const totalRes = Object.values(p.resources||{}).reduce((a,b)=>a+b,0);
    const devCount = (p.devCards||[]).filter(c=>!c.played&&c.type!=='vp').length;
    const avatarChar = avatarHtml(p.avatar, p.name, p.isBot, p.color);
    const card = document.createElement('div');
    card.className = 'mob-player-card' + (isActive?' active-turn':'') + (isSelf?' mob-self-card':'');
    const tc = colorTextClass(p.color);
    card.innerHTML = `
      <div class="mob-card-top">
        <div class="mob-vp-badge ${tc}" style="background:${p.color}">${p.vp}</div>
        <span class="mob-card-name">${escapeHtml(p.name)}${p.isBot?' 🤖':''}</span>
        ${p.id===state.longestRoadPlayer?'<span title="Longest Road" style="font-size:.6rem">🛣</span>':''}
        ${p.id===state.largestArmyPlayer?'<span title="Largest Army" style="font-size:.6rem">⚔</span>':''}
      </div>
      <div class="mob-card-res">
        <span class="mob-card-res-count">${totalRes}</span><img src="Icons/Dev card icon.png" class="piece-icon" alt="card">
        ${devCount>0?`<span style="margin-left:3px">${devCount}</span>📜`:''}
      </div>
      <div class="mob-card-bld">
        <span><img src="Icons/Tower Icon.png" class="piece-icon" alt="tower">${p.settlements||0}</span>
        <span><img src="Icons/Castle Icon.png" class="piece-icon" alt="castle">${p.cities||0}</span>
        <span>🛣${p.roads||0}</span>
      </div>`;
    el.appendChild(card);
  });
  // Update compact score strip (shown when collapsed)
  const strip = document.getElementById('mobileScoreStrip');
  if (strip) {
    strip.innerHTML = state.players.map(p => {
      const tc = colorTextClass(p.color);
      const active = p.id === state.players[state.currentPlayerIndex]?.id ? ' outline: 2px solid #fff;' : '';
      return `<span class="mob-score-badge ${tc}" style="background:${p.color};${active}">${p.vp}VP</span>`;
    }).join('');
  }
}

function updateBank(state) {
  const el = document.getElementById('bankResources');
  if (!el) return;

  if (state.bankStockTiers) {
    // Hidden mode — show stack icons (🂠 = card back representation)
    el.innerHTML = Object.entries(RES_INFO).map(([r,{icon}]) => {
      const tier = state.bankStockTiers[r] ?? 0;
      const stacks = '🂠'.repeat(tier) || '✕';
      const label = tier === 0 ? 'empty' : tier === 1 ? '1–8' : tier === 2 ? '9–14' : '15+';
      return `<div class="bank-chip${tier<=1?' bank-chip-low':''}"><span class="bc-icon">${icon}</span><span class="bc-count" title="${label}">${stacks}</span></div>`;
    }).join('');
  } else if (state.bankStock) {
    // Exact mode
    el.innerHTML = Object.entries(RES_INFO).map(([r,{icon}]) => {
      const inBank = state.bankStock[r] ?? 0;
      const low = inBank <= 3;
      return `<div class="bank-chip${low?' bank-chip-low':''}"><span class="bc-icon">${icon}</span><span class="bc-count">${inBank}</span></div>`;
    }).join('');
  } else {
    // Fallback: derive from player totals (old path)
    const totals = {};
    state.players.forEach(p => {
      Object.entries(p.resources||{}).forEach(([r,n]) => { totals[r] = (totals[r]||0)+n; });
    });
    el.innerHTML = Object.entries(RES_INFO).map(([r,{icon}]) => {
      const inBank = Math.max(0, 19 - (totals[r]||0));
      const low = inBank <= 3;
      return `<div class="bank-chip${low?' bank-chip-low':''}"><span class="bc-icon">${icon}</span><span class="bc-count">${inBank}</span></div>`;
    }).join('');
  }
}

function updatePlayersList(state) {
  const el = document.getElementById('playersList');
  if (!el) return;
  el.innerHTML = '';
  state.players.forEach((p, i) => {
    if (p.id === myId) return;
    const totalRes = Object.values(p.resources||{}).reduce((a,b)=>a+b,0);
    const devCount = (p.devCards||[]).filter(c=>!c.played&&c.type!=='vp').length;
    const isActive = i === state.currentPlayerIndex;
    const avatarContent = avatarHtml(p.avatar, p.name, p.isBot, p.color);
    const resChips = Array(Math.min(totalRes,12)).fill(0).map(()=>`<div class="card-chip res">?</div>`).join('')
                   + (totalRes>12 ? `<div class="card-chip-more">+${totalRes-12}</div>` : '');
    const devChips = Array(devCount).fill(0).map(()=>`<div class="card-chip dev">D</div>`).join('');
    const vol = voiceChat.getVolume(p.id);
    const isTalking = vol > 0.08;
    const isEmb = embargoed.has(p.id);
    const r = document.createElement('div');
    r.className = 'cpr' + (isActive ? ' active-turn' : '') + (isEmb ? ' embargoed' : '');
    const avatarTc = colorTextClass(p.color);
    r.innerHTML = `
      <div class="cpr-avatar${isTalking?' speaking':''} ${avatarTc}" style="background:${p.color}" data-pid="${escapeHtml(p.id)}" title="Click for options">${avatarContent}</div>
      <div class="cpr-mid">
        <div class="cpr-name">${escapeHtml(p.name)}${isEmb ? ' <span class="embargo-tag">🚫</span>' : ''}</div>
        <div class="cpr-vp">${p.vp} VP${p.id===state.longestRoadPlayer?' · 🛣 LR':''}${p.id===state.largestArmyPlayer?' · ⚔ LA':''}</div>
        <div class="cpr-cards">${resChips}${devChips}</div>
      </div>
      <div class="cpr-bld">
        <div class="cpr-hand-count" title="${totalRes} resource cards">${totalRes}<span class="cpr-hand-icon"><img src="Icons/Dev card icon.png" class="piece-icon" alt="card"></span></div>
        <div class="bld-item"><img src="Icons/Tower Icon.png" class="piece-icon" alt="tower"> ${p.settlements||0}</div>
        <div class="bld-item"><img src="Icons/Castle Icon.png" class="piece-icon" alt="castle"> ${p.cities||0}</div>
        <div class="bld-item">🛣 ${p.roads||0}</div>
      </div>`;
    r.querySelector('.cpr-avatar').addEventListener('click', e => {
      e.stopPropagation();
      showPlayerMenu(p, e.currentTarget);
    });
    el.appendChild(r);
  });
}

function showStealPicker(victims, onPick, markerMesh) {
  document.getElementById('stealPickerOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'stealPickerOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:900;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);';
  const box = document.createElement('div');
  box.style.cssText = 'background:rgba(14,16,26,0.96);border:1px solid rgba(255,255,255,0.15);border-radius:16px;padding:20px 24px;min-width:220px;backdrop-filter:blur(18px);box-shadow:0 12px 40px rgba(0,0,0,0.6);';
  box.innerHTML = `<div style="font-size:.85rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,0.55);margin-bottom:14px;">Steal from</div>`;
  victims.forEach(p => {
    const btn = document.createElement('button');
    btn.style.cssText = `display:flex;align-items:center;gap:10px;width:100%;padding:10px 14px;margin-bottom:8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.13);border-radius:10px;color:#fff;font-size:1rem;cursor:pointer;`;
    const dot = `<span style="width:14px;height:14px;border-radius:50%;background:${p.color};display:inline-block;flex-shrink:0;"></span>`;
    const totalRes = Object.values(p.resources||{}).reduce((a,b)=>a+b,0);
    const devCount = (p.devCards||[]).filter(c=>!c.played&&c.type!=='vp'&&c.type!=='hidden').length;
    const stats = `<span style="margin-left:auto;display:flex;gap:10px;font-size:.78rem;color:rgba(255,255,255,0.55);">
      <span title="Victory Points">⭐ ${p.vp}</span>
      <span title="Resource cards"><img src="Icons/Dev card icon.png" class="piece-icon" alt="card"> ${totalRes}</span>
      <span title="Dev cards">📜 ${devCount}</span>
    </span>`;
    btn.innerHTML = `${dot}<span>${escapeHtml(p.name)}</span>${stats}`;
    btn.addEventListener('click', () => {
      overlay.remove();
      document.getElementById('buildConfirm').style.display = 'none';
      onPick(p.id);
    });
    box.appendChild(btn);
  });
  overlay.appendChild(box);
  overlay.addEventListener('click', e => { if (e.target === overlay) { /* modal is required — must choose a victim */ } });
  document.body.appendChild(overlay);
}

function showPlayerMenu(p, anchorEl) {
  document.getElementById('playerContextMenu')?.remove();
  const isEmb = embargoed.has(p.id);
  const menu = document.createElement('div');
  menu.id = 'playerContextMenu';
  menu.className = 'player-ctx-menu';
  menu.innerHTML = `
    <div class="pcm-title">${escapeHtml(p.name)}</div>
    <button class="pcm-btn embargo-btn">${isEmb ? '✅ Lift Embargo' : '🚫 Embargo'}</button>
  `;
  menu.querySelector('.embargo-btn').addEventListener('click', () => {
    if (embargoed.has(p.id)) embargoed.delete(p.id);
    else embargoed.add(p.id);
    menu.remove();
    if (gameState) updatePlayersList(gameState);
  });
  document.body.appendChild(menu);
  const rect = anchorEl.getBoundingClientRect();
  menu.style.left = `${rect.right + 6}px`;
  menu.style.top  = `${rect.top}px`;
  const dismiss = () => { menu.remove(); document.removeEventListener('click', dismiss); };
  setTimeout(() => document.addEventListener('click', dismiss), 0);
}

function updateSelfPlayer(state, me) {
  const el = document.getElementById('selfPlayerSection');
  if (!el || !me) return;
  const initial = avatarHtml(me.avatar, me.name, false, me.color);
  const curr = state.players[state.currentPlayerIndex];
  const isActive = curr?.id === myId;
  const resHtml = Object.entries(RES_INFO).map(([r,{icon}]) =>
    `<div class="self-res"><span class="sri">${icon}</span><span class="srn">${me.resources[r]||0}</span></div>`
  ).join('');
  const DEV_CARD_ICONS = { knight:'⚔', roadBuilding:'🛣', yearOfPlenty:'🌟', monopoly:'💰', vp:'⭐' };
  const DEV_CARD_LABELS = { knight:'Knight', roadBuilding:'Road Building', yearOfPlenty:'Year of Plenty', monopoly:'Monopoly', vp:'Victory Point' };
  const devCards = (me.devCards||[]).filter(c=>!c.played&&c.type!=='hidden');
  const devHtml = devCards.length
    ? `<div class="self-devcards">`
      + devCards.map(c => `<div class="self-dev-card${c.newThisTurn?' dev-new':''}" title="${DEV_CARD_LABELS[c.type]??c.type}">
          <span class="sdc-icon">${DEV_CARD_ICONS[c.type]??'📜'}</span>
          <span class="sdc-label">${DEV_CARD_LABELS[c.type]??c.type}</span>
        </div>`).join('')
      + `</div>` : '';
  const selfTc = colorTextClass(me.color);
  el.innerHTML = `
    <div class="self-header" style="${isActive?'outline:2px solid '+me.color+';outline-offset:3px;border-radius:8px;padding:3px 4px':''}">
      <div class="self-avatar ${selfTc}" style="background:${me.color}">${initial}</div>
      <div class="self-name">${escapeHtml(me.name)}</div>
      <div class="self-vp">${me.vp} VP</div>
    </div>
    ${devHtml}`;
}

function updatePieces(state, me) {
  const el = document.getElementById('piecesRemaining');
  if (!el || !me) return;
  const pid = me.id;
  const roadsUsed = state.board ? state.board.edges.filter(e => e.road?.playerId === pid).length : 0;
  const settlesUsed = state.board ? state.board.vertices.filter(v => v.building?.playerId === pid && v.building.type === 'settlement').length : 0;
  const citiesUsed = state.board ? state.board.vertices.filter(v => v.building?.playerId === pid && v.building.type === 'city').length : 0;
  const roadsLeft = 15 - roadsUsed;
  const settlesLeft = 5 - settlesUsed - citiesUsed;
  const citiesLeft = 4 - citiesUsed;
  el.innerHTML = `
    <div class="piece-chip">🛣 <span>${roadsLeft}</span></div>
    <div class="piece-chip"><img src="Icons/Tower Icon.png" class="piece-icon" alt="tower"> <span>${settlesLeft}</span></div>
    <div class="piece-chip"><img src="Icons/Castle Icon.png" class="piece-icon" alt="castle"> <span>${citiesLeft}</span></div>`;
}

// ─── Card collection animation ────────────────────────────────────────────────
const RES_COLORS = { wood:'#4a7c20', brick:'#b03010', sheep:'#88b840', wheat:'#d4a010', ore:'#607080' };
function triggerCardAnimation(gained) {
  const wrapper = document.getElementById('canvasWrapper');
  if (!wrapper) return;
  const selfEl = document.getElementById('selfPlayerSection');
  const selfRect = selfEl?.getBoundingClientRect();
  const wrapRect = wrapper.getBoundingClientRect();
  const targetX = selfRect ? selfRect.left - wrapRect.left + selfRect.width * 0.5 : wrapRect.width * 0.5;
  const targetY = selfRect ? selfRect.top - wrapRect.top + selfRect.height * 0.3 : wrapRect.height * 0.8;

  // Bank is on the left side of the board — use the bank panel area as source
  const bankEl = document.getElementById('bankResources');
  const bankRect = bankEl?.getBoundingClientRect();
  const srcX = bankRect ? bankRect.left - wrapRect.left + bankRect.width * 0.5 : wrapRect.width * 0.15;
  const srcY = bankRect ? bankRect.top - wrapRect.top + bankRect.height * 0.5 : wrapRect.height * 0.5;

  let delay = 0;
  Object.entries(gained).forEach(([res, count]) => {
    const icon = TRADE_RES.find(r => r.key === res)?.icon ?? '?';
    const color = RES_COLORS[res] ?? '#888';
    for (let i = 0; i < Math.min(count, 6); i++) {
      setTimeout(() => {
        const card = document.createElement('div');
        card.className = 'card-anim';
        card.textContent = icon;
        card.style.cssText = `left:${srcX + (Math.random()-0.5)*30}px;top:${srcY + (Math.random()-0.5)*20}px;background:${color};`;
        wrapper.appendChild(card);
        requestAnimationFrame(() => {
          card.style.transform = `translate(${targetX - srcX + (Math.random()-0.5)*40}px, ${targetY - srcY}px) scale(0.4)`;
          card.style.opacity = '0';
        });
        setTimeout(() => card.remove(), 700);
      }, delay);
      delay += 80;
    }
  });
}

// Append new log entries as system messages in chat
let lastLogLength = 0;
function syncLog(state) {
  const log = state.log || [];
  if (log.length <= lastLogLength) { lastLogLength = Math.max(lastLogLength, log.length); return; }
  const container = document.getElementById('chatMessages');
  const toastArea = document.getElementById('logToastArea');
  for (let i = lastLogLength; i < log.length; i++) {
    const msg = log[i];
    // Append to persistent chat log
    if (container) {
      const div = document.createElement('div');
      div.className = 'chat-sys';
      div.textContent = msg;
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    }
    // Show floating toast (max 5 visible — evict oldest if over limit)
    if (toastArea) {
      const MAX_TOASTS = 5;
      const existing = toastArea.querySelectorAll('.log-toast');
      if (existing.length >= MAX_TOASTS) existing[0].remove();
      const toast = document.createElement('div');
      toast.className = 'log-toast';
      toast.textContent = msg;
      toastArea.appendChild(toast);
      setTimeout(() => { toast.classList.add('fading'); }, 5500);
      setTimeout(() => { toast.remove(); }, 7000);
    }
  }
  lastLogLength = log.length;
}

// ─── Voice Chat ───────────────────────────────────────────────────────────────
class VoiceChat {
  constructor() {
    this.peers = {};    // peerId → { pc, audio, analyser, muted }
    this.localStream = null;
    this.localAnalyser = null;
    this.audioCtx = null;
    this.micOn = false;
    this.selfMuted = false;
  }

  async enableMic() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.audioCtx = this.audioCtx || new AudioContext();
      if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
      const src = this.audioCtx.createMediaStreamSource(this.localStream);
      this.localAnalyser = this.audioCtx.createAnalyser();
      this.localAnalyser.fftSize = 256;
      src.connect(this.localAnalyser);
      this.micOn = true;
      // add local track to all existing peer connections
      Object.values(this.peers).forEach(({ pc }) => {
        this.localStream.getTracks().forEach(t => {
          const senders = pc.getSenders();
          if (!senders.find(s => s.track?.kind === t.kind)) pc.addTrack(t, this.localStream);
        });
      });
      socket.emit('voiceJoin');
    } catch(err) {
      console.warn('Mic error:', err);
      alert('Could not access microphone: ' + err.message);
    }
  }

  disableMic() {
    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null; this.localAnalyser = null; this.micOn = false;
    socket.emit('voiceLeft');
  }

  toggleSelfMute() {
    this.selfMuted = !this.selfMuted;
    if (this.localStream) this.localStream.getAudioTracks().forEach(t => { t.enabled = !this.selfMuted; });
    return this.selfMuted;
  }

  async createPeer(peerId, initiator) {
    if (this.peers[peerId]) return;
    const pc = new RTCPeerConnection({ iceServers:[{urls:'stun:stun.l.google.com:19302'}] });
    this.peers[peerId] = { pc, audio:null, analyser:null, muted:false };

    if (this.localStream) this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream));

    pc.ontrack = ev => {
      const stream = ev.streams[0];
      this.peers[peerId].stream = stream;
      const ctx = this.audioCtx = this.audioCtx||new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an  = ctx.createAnalyser(); an.fftSize = 256;
      src.connect(an);
      this.peers[peerId].analyser = an;
      const audio = new Audio();
      audio.srcObject = stream;
      audio.volume = AUDIO.vcMuted ? 0 : AUDIO.vcVolume;
      audio.muted = mutedPeers.has(peerId);
      audio.play().catch(()=>{});
      this.peers[peerId].audio = audio;
    };

    pc.onicecandidate = ev => { if (ev.candidate) socket.emit('voiceIce',{to:peerId, candidate:ev.candidate}); };
    pc.onconnectionstatechange = () => { if (['disconnected','failed','closed'].includes(pc.connectionState)) this.removePeer(peerId); };

    if (initiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('voiceOffer',{to:peerId, offer});
    }
  }

  async handleOffer(from, offer) {
    await this.createPeer(from, false);
    const pc = this.peers[from].pc;
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('voiceAnswer',{to:from, answer});
  }

  async handleAnswer(from, answer) {
    const p = this.peers[from]; if (p) await p.pc.setRemoteDescription(answer);
  }

  async handleIce(from, cand) {
    const p = this.peers[from]; if (p) await p.pc.addIceCandidate(cand).catch(()=>{});
  }

  removePeer(peerId) {
    const p = this.peers[peerId];
    if (!p) return;
    p.pc.close(); p.audio?.pause();
    delete this.peers[peerId];
  }

  getVolume(peerId) {
    const an = peerId === myId ? this.localAnalyser : this.peers[peerId]?.analyser;
    if (!an) return 0;
    const data = new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(data);
    return Math.min(1, data.reduce((a,b)=>a+b,0) / data.length / 30);
  }

  mutePeer(peerId, mute) {
    const p = this.peers[peerId]; if (!p) return;
    p.muted = mute;
    if (p.audio) p.audio.muted = mute;
  }
}

const voiceChat = new VoiceChat();

// Per-player mute state (independent of WebRTC connection state)
const mutedPeers = new Set();
// Embargoed players (local-only: refuse their trades)
const embargoed = new Set();

// ─── Voice UI update (called in animate loop) ──────────────────────────────────
function updateVoicePlayers() {
  if (!gameState) return;
  const container = document.getElementById('voicePlayers');
  if (!container) return;

  gameState.players.forEach(p => {
    let row = document.getElementById(`vp-row-${p.id}`);
    if (!row) {
      row = document.createElement('div');
      row.className = 'voice-player-row';
      row.id = `vp-row-${p.id}`;
      row.innerHTML = `
        <span class="voice-ring vp-dot" id="vp-ring-${p.id}" style="background:${p.color}"></span>
        <span class="vp-name">${p.name}</span>
        <div class="vp-vol"><div class="vp-vol-bar" id="vp-vol-${p.id}" style="width:0%"></div></div>
        ${p.id === myId
          ? `<button class="vp-mute-btn" id="vp-self-mute" title="Mute yourself">🎤</button>`
          : `<button class="vp-mute-btn" id="vp-mute-${p.id}" title="Mute ${p.name}">🔊</button>`
        }`;
      container.appendChild(row);

      if (p.id === myId) {
        document.getElementById('vp-self-mute')?.addEventListener('click', () => {
          const muted = voiceChat.toggleSelfMute();
          const btn = document.getElementById('vp-self-mute');
          if (btn) { btn.textContent = muted ? '🔇' : '🎤'; btn.classList.toggle('muted', muted); }
        });
      } else {
        document.getElementById(`vp-mute-${p.id}`)?.addEventListener('click', () => {
          const nowMuted = !mutedPeers.has(p.id);
          if (nowMuted) mutedPeers.add(p.id); else mutedPeers.delete(p.id);
          voiceChat.mutePeer(p.id, nowMuted);
          const btn = document.getElementById(`vp-mute-${p.id}`);
          if (btn) { btn.textContent = nowMuted ? '🔇' : '🔊'; btn.classList.toggle('muted', nowMuted); }
        });
      }
    }

    const vol = voiceChat.getVolume(p.id);
    const pct = Math.round(vol * 100);
    const bar = document.getElementById(`vp-vol-${p.id}`);
    const ring = document.getElementById(`vp-ring-${p.id}`);
    if (bar) { bar.style.width=`${pct}%`; bar.classList.toggle('loud', pct>60); }
    if (ring) ring.classList.toggle('talking', pct>8);
  });
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
function addChatMessage(msg) {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'chat-player';
  div.innerHTML = `<span class="cn" style="color:${msg.color}">${escapeHtml(msg.name)}:</span>${escapeHtml(msg.text)}`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function sendChat() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('chatMessage', { text });
  input.value = '';
}

// ─── Socket events ────────────────────────────────────────────────────────────

function fadeOutLobbyScreens(onDone) {
  const els = ['lobby', 'waiting'].map(id => document.getElementById(id)).filter(el => el && el.style.display !== 'none');
  if (!els.length) { onDone(); return; }
  els.forEach(el => el.classList.add('fading-out'));
  setTimeout(() => {
    els.forEach(el => { el.style.display = 'none'; el.classList.remove('fading-out'); });
    onDone();
  }, 580);
}

socket.on('joinedRoom', data => {
  myId = data.playerId; roomId = data.roomId;
  // Persist for rejoin detection on refresh/disconnect
  try { localStorage.setItem('ti_roomId', roomId); localStorage.setItem('ti_name', document.getElementById('playerName').value.trim() || ''); } catch(e) {}
  if (_joiningRoom) {
    _joiningRoom = false;
    const btnJoin = document.getElementById('btnJoin');
    if (btnJoin) btnJoin.disabled = false;
    document.getElementById('lobbyError').textContent = '';
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('waiting').style.display = 'flex';
  }
});

// Check for rejoin opportunity on connect
socket.on('connect', () => {
  try {
    const savedRoom = localStorage.getItem('ti_roomId');
    const savedName = localStorage.getItem('ti_name');
    if (savedRoom && savedName) socket.emit('checkRejoin', { roomId: savedRoom, name: savedName });
  } catch(e) {}
});

let _rejoinData = null;
socket.on('rejoinInfo', info => {
  _rejoinData = info;
  const banner = document.getElementById('rejoinBanner');
  if (banner) banner.style.display = info ? 'block' : 'none';
  if (info && document.getElementById('playerName').value === '') {
    document.getElementById('playerName').value = info.name;
  }
});

let _lobbyPlayerCount = 0;
socket.on('lobbyUpdate', data => {
  document.getElementById('roomCodeDisplay').textContent = roomId;
  const diffLabel = { easy: '🟢', medium: '🟡', hard: '🔴' };
  document.getElementById('waitingPlayerList').innerHTML = data.players.map(p =>
    `<li><span class="player-dot" style="background:${p.color}"></span>${p.isBot ? `🤖 ${diffLabel[p.difficulty]||''} ` : ''}${p.name}</li>`).join('');
  if (_lobbyPlayerCount > 0) {
    if (data.players.length > _lobbyPlayerCount) {
      const s = new Audio('sound effects/Bubbly Button.aac'); s.volume = sfxVol(); s.play().catch(() => {});
    } else if (data.players.length < _lobbyPlayerCount) {
      const s = new Audio('sound effects/Wrong Answer.aac'); s.volume = sfxVol(); s.play().catch(() => {});
    }
  }
  _lobbyPlayerCount = data.players.length;
  const isHost = data.hostId === myId;
  document.getElementById('btnStart').style.display = isHost ? 'block' : 'none';
  document.getElementById('botControls').style.display = isHost ? 'flex' : 'none';
  document.getElementById('waitingHint').style.display = isHost ? 'none' : 'block';
  const btnLeave = document.getElementById('btnLeaveWaiting');
  if (btnLeave) btnLeave.style.display = 'block';
  const settingsEl = document.getElementById('gameSettings');
  if (settingsEl) settingsEl.style.display = isHost ? 'block' : 'none';
  const hasBots = data.players.some(p => p.isBot);
  document.getElementById('btnRemoveBot').style.opacity = hasBots ? '1' : '0.4';
  document.getElementById('btnAddBot').style.opacity = data.players.length < 4 ? '1' : '0.4';
  _lobbyPlayers = data.players;
  _lobbyRenderVoice();
  // Sync settings checkboxes
  const chk = document.getElementById('chkHideBankCards');
  if (chk) chk.checked = !!(data.settings?.hideBankCards);
  const chkPrv = document.getElementById('chkPrivate');
  if (chkPrv) chkPrv.checked = !!data.isPrivate;
});

document.getElementById('btnAddBot').addEventListener('click', () => {
  const difficulty = document.getElementById('botDifficulty')?.value || 'medium';
  socket.emit('addBot', { difficulty });
});
document.getElementById('btnRemoveBot').addEventListener('click', () => socket.emit('removeBot'));
document.getElementById('chkHideBankCards').addEventListener('change', e => {
  socket.emit('setGameSetting', { key: 'hideBankCards', value: e.target.checked });
});

socket.on('gameUpdate', state => {
  const wasNull = !gameState;
  const prevStatus = gameState?.status;
  const newDice = state.dice && (!gameState?.dice ||
    state.dice[0] !== gameState.dice[0] || state.dice[1] !== gameState.dice[1]);
  // Detect resources gained (for card animation + sounds)
  const prevMe = gameState?.players.find(p => p.id === myId);
  const newMe  = state.players.find(p => p.id === myId);
  const gained = {};
  let totalGained = 0;
  if (prevMe && newMe && !wasNull) {
    TRADE_RES.forEach(({key}) => {
      const delta = (newMe.resources[key]||0) - (prevMe.resources[key]||0);
      if (delta > 0) { if (newDice) gained[key] = delta; totalGained += delta; }
    });
  }
  // Coin jingle when receiving resources — plays after dice sound finishes
  if (totalGained > 0) {
    const playCoinJingle = () => {
      const _coinJingle = new Audio('sound effects/Coins jingle.aac');
      _coinJingle.volume = sfxVol();
      _coinJingle.play().catch(() => {});
    };
    if (_diceSound.ended || _diceSound.paused) {
      playCoinJingle();
    } else {
      _diceSound.addEventListener('ended', playCoinJingle, { once: true });
      _diceSound.addEventListener('error', playCoinJingle, { once: true });
    }
  }
  // Longest road sound
  if (!wasNull && gameState?.longestRoadHolder !== state.longestRoadHolder && state.longestRoadHolder === myId) {
    _laughingSound.currentTime = 0;
    _laughingSound.volume = sfxVol();
    _laughingSound.play().catch(() => {});
  }
  // Largest army sound
  if (!wasNull && gameState?.largestArmyHolder !== state.largestArmyHolder && state.largestArmyHolder === myId) {
    const _armySound = new Audio('sound effects/largest army.aac');
    _armySound.volume = sfxVol();
    _armySound.play().catch(() => {});
  }
  // Detect newly placed buildings and roads for sounds + drop animations
  const newlyPlacedBuildings = [];
  const newlyPlacedRoads = [];
  let tradeSoundNeeded = false;
  let cityUpgraded = false;
  if (!wasNull && gameState) {
    state.board.vertices.forEach((v, i) => {
      const prev = gameState.board.vertices[i];
      if (v.building && !prev.building) {
        newlyPlacedBuildings.push({ x: v.x, z: v.z, type: v.building.type, vertexId: v.id });
      }
      if (v.building?.type === 'city' && prev.building?.type === 'settlement') {
        cityUpgraded = true;
      }
    });
    state.board.edges.forEach((e, i) => {
      const prev = gameState.board.edges[i];
      if (e.road && !prev.road) {
        const v1 = state.board.vertices[e.vertices[0]], v2 = state.board.vertices[e.vertices[1]];
        newlyPlacedRoads.push({ x: (v1.x+v2.x)/2, z: (v1.z+v2.z)/2, edgeId: e.id });
      }
    });
    // Trade succeeded: resources changed without dice roll
    if (!newDice && prevMe && newMe) {
      let anyChanged = false;
      TRADE_RES.forEach(({key}) => { if ((newMe.resources[key]||0) !== (prevMe.resources[key]||0)) anyChanged = true; });
      if (anyChanged) tradeSoundNeeded = true;
    }
  }
  // Play build sounds
  if (newlyPlacedRoads.length) {
    const s = new Audio('sound effects/Forge Item.aac');
    s.volume = sfxVol(); s.play().catch(() => {});
  }
  if (newlyPlacedBuildings.length) {
    const s = new Audio('sound effects/Rocky Impact Pebbles Tumbling.aac');
    s.volume = sfxVol(); s.play().catch(() => {});
  }
  if (cityUpgraded) {
    const s = new Audio('sound effects/viking horn.aac');
    s.volume = sfxVol(); s.play().catch(() => {});
  }
  if (tradeSoundNeeded) {
    const s = new Audio('sound effects/Coins Pick Up.aac');
    s.volume = sfxVol(); s.play().catch(() => {});
  }

  // Game start fanfare + board render — first time status leaves lobby
  const isSetupStatus = st => st === 'setup_forward' || st === 'setup_backward';
  if (!wasNull && prevStatus === 'lobby' && (isSetupStatus(state.status) || state.status === 'playing')) {
    _gameStartSound.currentTime = 0;
    _gameStartSound.volume = sfxVol();
    _gameStartSound.play().catch(() => {});
    // Re-render board with actual hexes and start the tile intro
    _introDone = false;
    renderBoard(state);
  }

  // Setup phase: play click sound when it becomes MY turn to place a settlement
  const isSetupNow = isSetupStatus(state.status);
  const isSetupWas = isSetupStatus(prevStatus);
  const currPlayer = state.players[state.currentPlayerIndex];
  const prevPlayer = gameState?.players[gameState?.currentPlayerIndex];
  if (isSetupNow && state.setupPhase === 'settlement' && currPlayer?.id === myId &&
      (prevPlayer?.id !== myId || !isSetupWas)) {
    _btnClickSound.currentTime = 0;
    _btnClickSound.volume = sfxVol();
    _btnClickSound.play().catch(() => {});
  }

  gameState = state;
  if (wasNull) {
    // Skip toasts for existing log entries on initial load
    lastLogLength = (state.log || []).length;
    if (state.status === 'lobby') {
      // Pre-render board silently in the background while players wait in lobby.
      // _introDone stays true so renderBoard builds the scene without scheduling intro.
      _introDone = true;
    } else if (state.status === 'playing' || state.status === 'game_over' || state.status === 'robber' || state.status === 'discarding') {
      _introDone = true; // rejoining a game already in progress — skip intro
      controls.enabled = true;
    } else {
      _introDone = false; // fresh game start — play intro
    }
    renderBoard(state);
    fadeOutLobbyScreens(() => {
      document.getElementById('game').style.display='flex';
      document.getElementById('btn2dToggle').style.display = 'block';
      resize();
    });
  }
  if (newDice) {
    triggerDiceRoll(state.dice[0], state.dice[1]);
    const total = state.dice[0] + state.dice[1];
    const hitHexes = state.board.hexes.filter(h => h.number === total);
    wiggleTokens(hitHexes.map(h => h.id));
    pulseTokensRed(hitHexes.map(h => h.id));
  }
  if (Object.keys(gained).length) triggerCardAnimation(gained);
  renderBuildings(state);

  // Kick off drop animations for newly placed pieces
  if (newlyPlacedBuildings.length || newlyPlacedRoads.length) {
    const newVertexIds = new Set(newlyPlacedBuildings.map(b => b.vertexId));
    const newEdgeIds = new Set(newlyPlacedRoads.map(r => r.edgeId));

    // Collect adjacent hex ids for shake
    const shakeHexIds = new Set();
    newlyPlacedBuildings.forEach(b => {
      const v = state.board.vertices[b.vertexId];
      (v?.adjacentHexes || []).forEach(hid => shakeHexIds.add(hid));
    });
    newlyPlacedRoads.forEach(r => {
      const e = state.board.edges[r.edgeId];
      (e?.vertices || []).forEach(vid => {
        const v = state.board.vertices[vid];
        (v?.adjacentHexes || []).forEach(hid => shakeHexIds.add(hid));
      });
    });

    buildGroup.children.forEach(mesh => {
      const isNewBuilding = newVertexIds.has(mesh.userData.vertexId);
      const isNewRoad = newEdgeIds.has(mesh.userData.edgeId);
      if (!isNewBuilding && !isNewRoad) return;
      const targetY = mesh.position.y;
      mesh.position.y = targetY + DROP_HEIGHT;
      const px = mesh.position.x, pz = mesh.position.z;
      dropAnims.push({
        mesh,
        targetY,
        t: 0,
        onLand: () => {
          spawnDust(px, targetY, pz);
          shakeHexes([...shakeHexIds], px, pz);
          // Check sheep on every affected hex directly by hex center
          const affectedHexCenters = gameState
            ? gameState.board.hexes.filter(h => shakeHexIds.has(h.id)).map(h => ({x:h.x, z:h.z}))
            : [];
          affectedHexCenters.forEach(c => wiggleSheepNear(c.x, c.z, HEX_R * 0.52));
        },
      });
    });
  }
  updateUI(state);

  // Discard modal: open if server wants this human player to discard
  if (state.status === 'discarding' && state.discardingPlayers?.[myId]) {
    const modal = document.getElementById('discardModal');
    if (modal.style.display !== 'flex') {
      const me = state.players.find(p => p.id === myId);
      openDiscardModal(state.discardingPlayers[myId], me?.resources || {});
      const dmg = new Audio('sound effects/Ni Sound - Toon World - Cartoon Sad Trumpet.aac');
      dmg.volume = sfxVol(); dmg.play().catch(() => {});
    }
  }

  if (state.status==='game_over'&&state.winner&&gameState?.status!=='game_over') {
    try { localStorage.removeItem('ti_roomId'); localStorage.removeItem('ti_name'); } catch(e) {}
    const w = state.players.find(p=>p.id===state.winner);
    const isWinner = state.winner === myId;
    document.getElementById('gameOverTitle').textContent = isWinner ? '🏆 You Win!' : `${w?.name} Wins!`;
    document.getElementById('gameOverMsg').textContent = isWinner ? 'Congratulations!' : 'Better luck next time!';
    // Build stats table
    const tbody = document.getElementById('gameOverStatsBody');
    if (tbody) {
      tbody.innerHTML = '';
      const sorted = [...state.players].sort((a, b) => (b.vp ?? 0) - (a.vp ?? 0));
      for (const p of sorted) {
        const isW = p.id === state.winner;
        const badges = [
          p.largestArmy ? '<span title="Largest Army">⚔️</span>' : '',
          p.longestRoad ? '<span title="Longest Road">🛣️</span>' : '',
        ].filter(Boolean).join(' ');
        const tr = document.createElement('tr');
        tr.style.cssText = isW ? 'background:rgba(255,215,0,.12);font-weight:700' : '';
        tr.innerHTML = `
          <td style="padding:6px 8px">${isW ? '🏆 ' : ''}${p.name}</td>
          <td style="padding:6px 8px;text-align:center">${p.vp ?? 0}</td>
          <td style="padding:6px 8px;text-align:center">${p.knightsPlayed ?? 0}</td>
          <td style="padding:6px 8px;text-align:center">${p.longestRoadLength ?? 0}</td>
          <td style="padding:6px 8px;text-align:center">${badges || '—'}</td>
        `;
        tbody.appendChild(tr);
      }
    }
    document.getElementById('gameOverBanner').style.display='flex';
    if (isWinner) {
      const win = new Audio('sound effects/Game Win Short Chime Sweep.aac');
      win.volume = sfxVol(); win.play().catch(() => {});
    } else {
      const lose = new Audio('sound effects/game over.mp3');
      lose.volume = sfxVol(); lose.play().catch(() => {});
    }
  }

  const curr = state.players[state.currentPlayerIndex];
  if (curr?.id===myId) {
    const isSetup=state.status==='setup_forward'||state.status==='setup_backward';
    const isRobber=state.status==='robber';
    if (isSetup&&!buildMode) { if(state.setupPhase==='settlement') enterBuildMode('settlement'); else if(state.setupPhase==='road') enterBuildMode('road'); }
    if (isRobber&&state.robbingPlayer===myId&&!buildMode) enterBuildMode('robber');
  } else { exitBuildMode(); }
});

socket.on('timerBonus', ({ sec }) => { addTimerBonus(sec || 30); });

socket.on('playerDisconnected', ({ name }) => {
  _logoutSound.currentTime = 0;
  _logoutSound.volume = sfxVol();
  _logoutSound.play().catch(() => {});
});

socket.on('playerReconnected', ({ name }) => {
  // No special sound needed; the activity log already shows it
});

const RES_ICON_MAP = { wood:'🪵', brick:'🧱', sheep:'🐑', wheat:'🌾', ore:'🪨' };

function animateResourceGain(gained) {
  const bankEl = document.getElementById('bankResources');
  if (!bankEl) return;
  const bankRect = bankEl.getBoundingClientRect();
  const srcX = bankRect.left + bankRect.width / 2;
  const srcY = bankRect.top  + bankRect.height / 2;

  let delay = 0;
  Object.entries(gained).forEach(([pid, { res }]) => {
    let isMe = pid === myId;
    let targetEl = isMe
      ? document.getElementById('myResourceBar')
      : document.querySelector(`.cpr-avatar[data-pid="${CSS.escape(pid)}"]`)?.closest('.cpr');
    if (!targetEl) return;

    Object.entries(res).forEach(([r, amt]) => {
      const icon = RES_ICON_MAP[r] || r;
      for (let i = 0; i < amt; i++) {
        const d = delay;
        delay += 80;
        setTimeout(() => {
          const el = document.createElement('span');
          el.textContent = icon;
          el.style.cssText = `
            position:fixed; z-index:9999; font-size:1.6rem; pointer-events:none;
            left:${srcX}px; top:${srcY}px; transform:translate(-50%,-50%);
            transition:left 0.65s cubic-bezier(.25,.8,.35,1), top 0.65s cubic-bezier(.25,.8,.35,1), opacity 0.65s ease;
            opacity:1;
          `;
          document.body.appendChild(el);
          requestAnimationFrame(() => {
            const tr = targetEl.getBoundingClientRect();
            const tx = tr.left + tr.width / 2;
            const ty = tr.top  + tr.height / 2;
            el.style.left = tx + 'px';
            el.style.top  = ty + 'px';
            el.style.opacity = '0';
          });
          setTimeout(() => el.remove(), 800);
        }, d);
      }
    });
  });
}

socket.on('resourceGain', gained => { animateResourceGain(gained); });

socket.on('gameError', msg => {
  // If we were in the middle of a join attempt, show error back on the lobby
  if (_joiningRoom) {
    _joiningRoom = false;
    const btnJoin = document.getElementById('btnJoin');
    if (btnJoin) btnJoin.disabled = false;
    const errEl = document.getElementById('lobbyError');
    if (errEl) errEl.textContent = '⚠ ' + msg;
    return;
  }
  const waitEl = document.getElementById('waitingHint');
  if (document.getElementById('waiting')?.style.display !== 'none' && waitEl) {
    waitEl.style.color='#f88'; waitEl.textContent='⚠ '+msg; waitEl.style.display='block'; return;
  }
  const container = document.getElementById('chatMessages');
  if (container) {
    const d = document.createElement('div'); d.className='chat-sys';
    d.style.color='#c0392b'; d.textContent='⚠ '+msg;
    container.appendChild(d); container.scrollTop=container.scrollHeight;
  }
});

// ─── Lobby chat + voice ───────────────────────────────────────────────────────
let _lobbyVoiceActive = false;
let _lobbyPlayers = [];  // latest lobby player list

function _lobbyAddChat(msg) {
  const box = document.getElementById('lobbyChatMessages');
  if (!box) return;
  const div = document.createElement('div');
  if (msg.system) {
    div.className = 'lc-sys';
    div.textContent = msg.text;
  } else {
    div.className = 'lc-msg';
    div.innerHTML = `<span class="lc-name" style="color:${msg.color}">${escapeHtml(msg.name)}:</span>${escapeHtml(msg.text)}`;
  }
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function _lobbyRenderVoice() {
  const container = document.getElementById('lobbyVoiceUsers');
  if (!container) return;
  container.innerHTML = '';
  _lobbyPlayers.forEach(p => {
    if (p.isBot) return;
    const el = document.createElement('div');
    el.className = 'lobby-voice-user';
    const isSelf = p.id === myId;
    const peerMuted = !isSelf && (voiceChat.peers[p.id]?.muted ?? false);
    el.innerHTML = `
      <span class="lv-ring" id="lv-ring-${p.id}" style="background:${p.color}"></span>
      <span>${escapeHtml(p.name)}${isSelf ? ' (you)' : ''}</span>
      ${!isSelf ? `<button class="lv-mute-btn" data-pid="${p.id}" title="${peerMuted ? 'Unmute' : 'Mute'}">${peerMuted ? '🔇' : '🔊'}</button>` : ''}
    `;
    el.querySelector('.lv-mute-btn')?.addEventListener('click', function() {
      const pid = this.dataset.pid;
      const nowMuted = !voiceChat.peers[pid]?.muted;
      voiceChat.mutePeer(pid, nowMuted);
      _lobbyRenderVoice();
    });
    container.appendChild(el);
  });
}

// Update voice rings in lobby from analyser
function _lobbyUpdateVoiceRings() {
  if (!_lobbyVoiceActive) return;
  // Self ring via local analyser
  const selfRing = document.getElementById(`lv-ring-${myId}`);
  if (selfRing && voiceChat.localAnalyser && voiceChat.micOn && !voiceChat.selfMuted) {
    const arr = new Uint8Array(voiceChat.localAnalyser.frequencyBinCount);
    voiceChat.localAnalyser.getByteFrequencyData(arr);
    const pct = arr.reduce((a,b)=>a+b,0)/arr.length/2.55;
    selfRing.classList.toggle('talking', pct > 8);
  }
  // Peer rings
  Object.entries(voiceChat.peers).forEach(([pid, peer]) => {
    const ring = document.getElementById(`lv-ring-${pid}`);
    if (!ring || !peer.analyser) return;
    const arr = new Uint8Array(peer.analyser.frequencyBinCount);
    peer.analyser.getByteFrequencyData(arr);
    const pct = arr.reduce((a,b)=>a+b,0)/arr.length/2.55;
    ring.classList.toggle('talking', pct > 8);
  });
}

// Lobby mic button
document.getElementById('lobbyMicBtn')?.addEventListener('click', async function() {
  if (!voiceChat.micOn) {
    this.textContent = '⏳ Connecting…';
    this.disabled = true;
    await voiceChat.enableMic();
    this.disabled = false;
    if (voiceChat.micOn) {
      voiceChat.selfMuted = false;
      voiceChat.localStream?.getAudioTracks().forEach(t => { t.enabled = true; });
      _lobbyVoiceActive = true;
      this.textContent = '🎤 Live';
      this.className = 'lobby-mic-btn active';
      _lobbyAddChat({ system: true, text: 'You joined voice.' });
    } else {
      this.textContent = '🔇 Muted';
      this.className = 'lobby-mic-btn muted';
    }
  } else if (!voiceChat.selfMuted) {
    voiceChat.selfMuted = true;
    voiceChat.localStream?.getAudioTracks().forEach(t => { t.enabled = false; });
    this.textContent = '🔇 Muted';
    this.className = 'lobby-mic-btn muted';
  } else {
    voiceChat.selfMuted = false;
    voiceChat.localStream?.getAudioTracks().forEach(t => { t.enabled = true; });
    this.textContent = '🎤 Live';
    this.className = 'lobby-mic-btn active';
  }
});

// Lobby text chat send
function _sendLobbyChat() {
  const input = document.getElementById('lobbyChatInput');
  const text = input?.value?.trim();
  if (!text) return;
  socket.emit('chatMessage', { text });
  input.value = '';
}
document.getElementById('lobbyChatSend')?.addEventListener('click', _sendLobbyChat);
document.getElementById('lobbyChatInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') _sendLobbyChat();
});

socket.on('chatMessage', msg => {
  // Render in lobby chat if we're still in the lobby
  const inLobby = document.getElementById('lobby')?.style.display !== 'none';
  if (inLobby) _lobbyAddChat(msg);

  addChatMessage(msg);
  // Mirror to mobile chat
  const mob = document.getElementById('mobileChatMessages');
  if (mob) {
    const div = document.createElement('div');
    div.className = 'chat-player';
    div.innerHTML = `<span class="cn" style="color:${msg.color}">${escapeHtml(msg.name)}:</span>${escapeHtml(msg.text)}`;
    mob.appendChild(div);
    mob.scrollTop = mob.scrollHeight;
  }
});

// ── Voice signalling ──
socket.on('voicePeerJoined', async ({ peerId }) => { await voiceChat.createPeer(peerId, true); });
socket.on('voiceOffer',  async ({ from, offer })  => { await voiceChat.handleOffer(from, offer); });
socket.on('voiceAnswer', async ({ from, answer }) => { await voiceChat.handleAnswer(from, answer); });
socket.on('voiceIce',    async ({ from, candidate }) => { await voiceChat.handleIce(from, candidate); });
socket.on('voicePeerLeft', ({ peerId }) => { voiceChat.removePeer(peerId); });

// ─── Button handlers ──────────────────────────────────────────────────────────

// Public lobby list
socket.on('lobbyList', list => {
  const container = document.getElementById('publicLobbies');
  const hint = document.getElementById('noLobbiesHint');
  if (!container) return;
  const entries = container.querySelectorAll('.lobby-entry');
  entries.forEach(e => e.remove());
  if (!list.length) {
    if (hint) hint.style.display = 'block';
    return;
  }
  if (hint) hint.style.display = 'none';
  list.forEach(l => {
    const div = document.createElement('div');
    div.className = 'lobby-entry';
    const humanCount = l.playerCount + (l.botCount ? ` + ${l.botCount} bot${l.botCount>1?'s':''}` : '');
    div.innerHTML = `
      <div class="lobby-entry-info">
        <span class="lobby-entry-host">${escapeHtml(l.host)}'s game</span>
        <span class="lobby-entry-count">${humanCount} / ${l.maxPlayers} players</span>
      </div>
      <button class="btn btn-secondary">Join</button>`;
    div.querySelector('button').addEventListener('click', () => {
      const name = document.getElementById('playerName').value.trim();
      if (!name) { document.getElementById('lobbyError').textContent = 'Enter your name first'; return; }
      document.getElementById('lobbyError').textContent = 'Joining…';
      document.getElementById('btnJoin').disabled = true;
      _joiningRoom = true;
      socket.emit('joinRoom', { roomId: l.roomId, name, avatar: _playerAvatar });
    });
    container.appendChild(div);
  });
});

// Request lobby list on load
socket.emit('getLobbies');

document.getElementById('btnRejoin').addEventListener('click', () => {
  if (!_rejoinData) return;
  document.getElementById('playerName').value = _rejoinData.name;
  document.getElementById('lobbyError').textContent = 'Rejoining…';
  _joiningRoom = true;
  socket.emit('joinRoom', { roomId: _rejoinData.roomId, name: _rejoinData.name, avatar: _playerAvatar });
});

// Lobby
document.getElementById('btnCreate').addEventListener('click', () => {
  const name = document.getElementById('playerName').value.trim();
  if (!name) { document.getElementById('lobbyError').textContent='Enter your name first'; return; }
  document.getElementById('lobbyError').textContent='';
  try { localStorage.setItem('ti_playerName', name); } catch(e) {}
  socket.emit('createRoom', { name, isPrivate: false, avatar: _playerAvatar });
  document.getElementById('lobby').style.display='none';
  document.getElementById('waiting').style.display='flex';
});

// Private toggle in waiting room
document.getElementById('chkPrivate')?.addEventListener('change', function () {
  socket.emit('setPrivate', { isPrivate: this.checked });
});
let _joiningRoom = false;
document.getElementById('btnJoin').addEventListener('click', () => {
  const name=document.getElementById('playerName').value.trim();
  const code=document.getElementById('roomCodeInput').value.trim().toUpperCase();
  if (!name) { document.getElementById('lobbyError').textContent='Enter your name first'; return; }
  if (!code) { document.getElementById('lobbyError').textContent='Enter a room code'; return; }
  document.getElementById('lobbyError').textContent='Joining…';
  document.getElementById('btnJoin').disabled = true;
  _joiningRoom = true;
  try { localStorage.setItem('ti_playerName', name); } catch(e) {}
  socket.emit('joinRoom', { roomId: code, name, avatar: _playerAvatar });
});
document.getElementById('btnStart').addEventListener('click', () => socket.emit('startGame'));
document.getElementById('btnLeaveWaiting').addEventListener('click', () => {
  socket.emit('leaveRoom');
  document.getElementById('waiting').style.display = 'none';
  document.getElementById('lobby').style.display = 'flex';
  document.getElementById('waitingHint').style.color = '';
  document.getElementById('waitingHint').textContent = 'Waiting for host to start…';
  document.getElementById('btnLeaveWaiting').style.display = 'none';
});

document.getElementById('btnExitGame')?.addEventListener('click', () => {
  if (!confirm('Exit to lobby?')) return;
  socket.emit('leaveRoom');
  document.getElementById('game').style.display = 'none';
  document.getElementById('lobby').style.display = 'flex';
});

// Game (btnRoll/btnEndTurn handled dynamically by mainActionBtn)
document.getElementById('btnSettle').addEventListener('click', () => enterBuildMode('settlement'));
document.getElementById('btnCity').addEventListener('click',   () => enterBuildMode('city'));
document.getElementById('btnRoad').addEventListener('click',   () => enterBuildMode('road'));
document.getElementById('btnCancel').addEventListener('click', () => exitBuildMode());

// ── Mobile UI handlers ──────────────────────────────────────────────────────
(function() {
  // Player cards toggle
  const pcToggle = document.getElementById('mobileCardsToggle');
  const pcEl = document.getElementById('mobilePlayerCards');
  if (pcToggle && pcEl) {
    pcToggle.addEventListener('click', () => {
      const collapsed = pcEl.classList.toggle('collapsed');
      pcToggle.textContent = collapsed ? '▲' : '▼';
    });
  }

  // Mobile chat overlay
  const chatOverlay = document.getElementById('mobileChatOverlay');
  document.getElementById('mBtnChat')?.addEventListener('click', () => {
    chatOverlay?.classList.add('open');
  });
  document.getElementById('mBtnChatClose')?.addEventListener('click', () => {
    chatOverlay?.classList.remove('open');
  });
  chatOverlay?.addEventListener('click', e => {
    if (e.target === chatOverlay) chatOverlay.classList.remove('open');
  });

  // Mobile chat send
  function sendMobileChat() {
    const inp = document.getElementById('mobileChatText');
    const text = inp?.value.trim();
    if (!text) return;
    socket.emit('chatMessage', { text });
    inp.value = '';
  }
  document.getElementById('mobileChatSend')?.addEventListener('click', sendMobileChat);
  document.getElementById('mobileChatText')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendMobileChat();
  });

  // Mobile log overlay
  const logOverlay = document.getElementById('mobileLogOverlay');
  document.getElementById('mBtnLog')?.addEventListener('click', () => {
    logOverlay?.classList.add('open');
    // Populate log from desktop messages
    const src = document.getElementById('chatMessages');
    const dst = document.getElementById('mobileLogMessages');
    if (src && dst) {
      dst.innerHTML = '';
      src.querySelectorAll('.chat-sys').forEach(el => {
        dst.appendChild(el.cloneNode(true));
      });
      dst.scrollTop = dst.scrollHeight;
    }
  });
  document.getElementById('mBtnLogClose')?.addEventListener('click', () => {
    logOverlay?.classList.remove('open');
  });
  logOverlay?.addEventListener('click', e => {
    if (e.target === logOverlay) logOverlay.classList.remove('open');
  });
  // Volume overlay (still accessible via settings; mBtnVol removed from top bar)
  const volOverlay = document.getElementById('mobileVolOverlay');
  document.getElementById('mBtnVolClose')?.addEventListener('click', () => {
    volOverlay?.classList.remove('open');
  });
  volOverlay?.addEventListener('click', e => {
    if (e.target === volOverlay) volOverlay.classList.remove('open');
  });

  // Mic row
  const mVolMicMute = document.getElementById('mVolMicMute');
  mVolMicMute?.addEventListener('click', () => {
    if (typeof voiceChat !== 'undefined') voiceChat.toggleMute?.();
    const muted = voiceChat?.isMuted?.() ?? false;
    mVolMicMute.textContent = muted ? '🔇' : '🎤';
    mVolMicMute.classList.toggle('off', muted);
    mVolMicMute.classList.toggle('on', !muted);
  });
  const mVolMicVol = document.getElementById('mVolMicVol');
  mVolMicVol?.addEventListener('input', () => {
    if (typeof voiceChat !== 'undefined') voiceChat.setVolume?.(parseFloat(mVolMicVol.value));
  });

  // Music row — mirrors the settings panel audio row
  function wireMobAudioRow(muteId, volId, getMuted, setMuted, getVol, setVol, onApply) {
    const btn = document.getElementById(muteId);
    const sld = document.getElementById(volId);
    if (!btn || !sld) return;
    sld.value = getVol();
    btn.addEventListener('click', () => {
      setMuted(!getMuted());
      btn.textContent = getMuted() ? '🔇' : '🔊';
      btn.classList.toggle('off', getMuted());
      btn.classList.toggle('on', !getMuted());
      onApply();
    });
    sld.addEventListener('input', () => {
      setVol(parseFloat(sld.value));
      onApply();
    });
  }
  wireMobAudioRow(
    'mVolMusicMute', 'mVolMusicVol',
    () => AUDIO.musicMuted,  v => { AUDIO.musicMuted = v; },
    () => AUDIO.musicVolume, v => { AUDIO.musicVolume = v; },
    () => AUDIO.applyMusicVolume?.()
  );
  wireMobAudioRow(
    'mVolSfxMute', 'mVolSfxVol',
    () => AUDIO.sfxMuted,  v => { AUDIO.sfxMuted = v; },
    () => AUDIO.sfxVolume, v => { AUDIO.sfxVolume = v; },
    applyAudioParams
  );
  wireMobAudioRow(
    'mVolVoMute', 'mVolVoVol',
    () => AUDIO.voMuted,  v => { AUDIO.voMuted = v; },
    () => AUDIO.voVolume, v => { AUDIO.voVolume = v; },
    () => {}
  );

  // ── Camera preset popup (mobile button + desktop left-bar button) ──────────
  const cameraPopup = document.getElementById('cameraPresetPopup');
  const cameraInner = document.getElementById('cameraPresetInner');

  function buildCameraPopup(anchorEl) {
    if (!cameraPopup || !cameraInner) return;
    // Populate buttons once
    if (!cameraInner.hasChildNodes()) {
      Object.keys(CAMERA_PRESETS).forEach(name => {
        const btn = document.createElement('button');
        btn.className = 'cam-preset-btn';
        btn.textContent = name;
        btn.addEventListener('click', () => {
          applyCameraPreset(name);
          cameraPopup.style.display = 'none';
        });
        cameraInner.appendChild(btn);
      });
    }
    // Position near anchor
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      cameraPopup.style.right = (window.innerWidth - rect.left + 6) + 'px';
      cameraPopup.style.top = rect.top + 'px';
      cameraPopup.style.left = '';
    } else {
      cameraPopup.style.right = '60px';
      cameraPopup.style.top = '50%';
      cameraPopup.style.left = '';
    }
    cameraPopup.style.display = cameraPopup.style.display === 'block' ? 'none' : 'block';
  }

  document.getElementById('mBtnCamera')?.addEventListener('click', e => {
    buildCameraPopup(e.currentTarget);
  });
  document.getElementById('btnCameraDesktop')?.addEventListener('click', e => {
    buildCameraPopup(e.currentTarget);
  });
  document.addEventListener('click', e => {
    if (!cameraPopup || cameraPopup.style.display !== 'block') return;
    if (!cameraPopup.contains(e.target) &&
        e.target.id !== 'mBtnCamera' && e.target.id !== 'btnCameraDesktop') {
      cameraPopup.style.display = 'none';
    }
  });

  // ── Mic / voice overlay ────────────────────────────────────────────────────
  const micOverlay = document.getElementById('micVoiceOverlay');

  function openMicOverlay() {
    if (!micOverlay) return;
    // Populate player list
    const list = document.getElementById('voicePlayerList');
    if (list && gameState) {
      list.innerHTML = '';
      gameState.players.forEach(p => {
        if (p.id === myId) return;
        const row = document.createElement('div');
        row.className = 'voice-player-row';
        const muted = voiceChat?.peers?.[p.id]?.muted ?? false;
        row.innerHTML = `<span class="voice-player-name">${p.name}</span>
          <button class="voice-mute-btn ${muted ? 'off' : 'on'}" data-pid="${p.id}">${muted ? '🔇' : '🔊'}</button>`;
        list.appendChild(row);
      });
      list.querySelectorAll('.voice-mute-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const pid = btn.dataset.pid;
          const nowMuted = !(btn.classList.contains('off'));
          voiceChat.mutePeer(pid, nowMuted);
          btn.classList.toggle('off', nowMuted);
          btn.classList.toggle('on', !nowMuted);
          btn.textContent = nowMuted ? '🔇' : '🔊';
        });
      });
    }
    micOverlay.style.display = 'flex';
  }

  // Music vol in mic overlay — mirrors AUDIO state
  const micMusicMute = document.getElementById('micMusicMute');
  const micMusicVol  = document.getElementById('micMusicVol');
  micMusicMute?.addEventListener('click', () => {
    AUDIO.musicMuted = !AUDIO.musicMuted;
    micMusicMute.textContent = AUDIO.musicMuted ? '🔇' : '🔊';
    micMusicMute.className = AUDIO.musicMuted ? 'mic-btn off' : 'mic-btn on';
    AUDIO.applyMusicVolume?.();
    // sync other music sliders
    document.getElementById('mVolMusicMute')?.setAttribute('data-muted', AUDIO.musicMuted);
  });
  micMusicVol?.addEventListener('input', () => {
    AUDIO.musicVolume = parseFloat(micMusicVol.value);
    AUDIO.applyMusicVolume?.();
  });

  document.getElementById('mBtnMic')?.addEventListener('click', openMicOverlay);
  document.getElementById('mBtnMicClose')?.addEventListener('click', () => {
    if (micOverlay) micOverlay.style.display = 'none';
  });
  micOverlay?.addEventListener('click', e => {
    if (e.target === micOverlay) micOverlay.style.display = 'none';
  });

  // Mic toggle button inside overlay
  document.getElementById('micToggleBtn')?.addEventListener('click', async function () {
    if (!voiceChat.micOn) {
      this.textContent = '⏳';
      await voiceChat.enableMic();
      if (voiceChat.micOn) { this.textContent = '🎤'; this.className = 'mic-btn on'; }
      else { this.textContent = '🚫'; this.className = 'mic-btn off'; }
    } else {
      voiceChat.disableMic();
      this.textContent = '🎤 Off'; this.className = 'mic-btn off';
    }
  });
})();

// Settings panel — password protected, desktop only
(function () {
  const SETTINGS_PW = 'nussetussa123';
  const panel = document.getElementById('settingsPanel');
  const btnOpen = document.getElementById('btnSettings');
  const btnClose = document.getElementById('btnSettingsClose');

  function isUnlocked() { return sessionStorage.getItem('settingsUnlocked') === '1'; }

  function openSettings() {
    panel.classList.add('open');
    btnOpen.classList.add('active');
    // Show +Res debug button once unlocked
    const dbg = document.getElementById('btnGetAllRes');
    if (dbg) dbg.style.display = 'flex';
    document.getElementById('btnGetAllRes')?.addEventListener('click', () => socket.emit('debugGetAllRes'), { once: true });
  }

  // Collapsible category toggle
  document.querySelectorAll('.settings-section-label.collapsible').forEach(lbl => {
    lbl.addEventListener('click', () => {
      const body = lbl.nextElementSibling;
      if (!body || !body.classList.contains('settings-cat-body')) return;
      const open = window.getComputedStyle(body).display !== 'none';
      body.style.display = open ? 'none' : 'block';
      lbl.classList.toggle('open', !open);
    });
  });

  document.getElementById('cameraPresetSelect')?.addEventListener('change', e => {
    applyCameraPreset(e.target.value);
  });

  btnOpen.addEventListener('click', () => {
    if (panel.classList.contains('open')) {
      panel.classList.remove('open');
      btnOpen.classList.remove('active');
      return;
    }
    if (isUnlocked()) { openSettings(); return; }
    const pw = prompt('Enter settings password:');
    if (pw === SETTINGS_PW) {
      sessionStorage.setItem('settingsUnlocked', '1');
      openSettings();
    } else if (pw !== null) {
      alert('Incorrect password.');
    }
  });

  btnClose.addEventListener('click', () => {
    panel.classList.remove('open');
    btnOpen.classList.remove('active');
  });

  document.querySelectorAll('.tile-slider').forEach(el => {
    const param = el.dataset.param;
    const type  = el.dataset.type;
    const input = el.querySelector('input[type=range]');
    const valEl = el.querySelector('.slider-val');

    if (!input) return; // skip non-range sliders (e.g. camera preset select)

    function updateTrack() {
      const min = parseFloat(input.min), max = parseFloat(input.max), val = parseFloat(input.value);
      const pct = ((val - min) / (max - min) * 100).toFixed(1);
      input.style.setProperty('--pct', pct + '%');
    }
    updateTrack();

    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      valEl.textContent = v.toFixed(2);
      updateTrack();
      if (param === 'tileHeight') {
        TILE_HEIGHT_MULT[type] = v;
      } else if (param === 'tileY') {
        TILE_Y_OFFSET[type] = v;
      } else if (param === 'numberY') {
        NUMBER_Y_OFFSET[type] = v;
      } else if (param === 'scene') {
        SCENE_PARAMS[type] = v;
      } else if (param === 'water') {
        WATER_PARAMS[type] = v;
        return; // water uniforms are synced every frame
      } else if (param === 'light') {
        LIGHT_PARAMS[type] = v;
        applyLightParams();
        return;
      } else if (param === 'sky') {
        SKY_PARAMS[type] = v;
        return; // synced every frame in animate loop
      } else if (param === 'lava') {
        LAVA_PARAMS[type] = v;
        // steamAmount/steamGravity/steamOpacity are live; geometry params need rebuild
        if (type === 'steamAmount' || type === 'steamGravity' || type === 'steamOpacity') return;
        if (gameState) buildLava(gameState.board.hexes);
        return;
      } else if (param === 'cloud') {
        CLOUD_PARAMS[type] = v;
        // brightness/opacity/speed are live; amount/height/spread/scale/enabled need re-render
        if (type === 'opacity' || type === 'speed' || type === 'brightness') return;
      } else if (param === 'robber') {
        ROBBER_PARAMS[type] = v;
        if (gameState) renderBuildings(gameState);
        return;
      } else if (param === 'outline') {
        if (type === 'thickness') { _outlinePasses.forEach(o => { o.pass.edgeThickness = v; }); }
        else if (type === 'glow')  { _outlinePasses.forEach(o => { o.pass.edgeGlow = v; }); }
        else if (type === 'strength') { _outlinePasses.forEach(o => { o.pass.edgeStrength = v; }); }
        return;
      } else if (param === 'building') {
        if (type === 'colorTint') SCENE_PARAMS.buildingColorTint = v;
        else if (type === 'colorSaturation') SCENE_PARAMS.buildingColorSaturation = v;
        if (gameState) renderBuildings(gameState);
        return;
      } else if (param === 'bob') {
        BOB_PARAMS[type] = v;
        return;
      } else if (param === 'waterSprite') {
        WATER_SPRITE_PARAMS[type] = v;
        return;
      } else if (param === 'token') {
        if (type === 'token3dDepth') SCENE_PARAMS.token3dDepth = v;
        else if (type === 'token3dScale') SCENE_PARAMS.token3dScale = v;
        else if (type === 'tokenMetalness') SCENE_PARAMS.tokenMetalness = v;
        else if (type === 'tokenRoughness') SCENE_PARAMS.tokenRoughness = v;
        else if (type === 'token3dRed') SCENE_PARAMS.token3dRed = v;
        else if (type === 'token3dSilver') SCENE_PARAMS.token3dSilver = v;
        else if (type === 'token3dRingColor') SCENE_PARAMS.token3dRingColor = v;
        if (gameState) renderBoard(gameState);
        return;
      } else if (param === 'cameraZoom') {
        camera.zoom = v;
        camera.updateProjectionMatrix();
        return;
      } else if (param === 'bank') {
        BANK_PARAMS[type] = v;
        if (type === 'islandR' || type === 'islandH') {
          if (gameState) renderBoard(gameState);
        } else {
          applyBankParams();  // live update position/scale/rotation
        }
        return;
      }
      if (!gameState) return;
      // robberY only needs buildings re-render
      if (param === 'scene' && type === 'sandRadius') {
        const mat = boardGroup.userData.sandMat;
        if (mat) mat.uniforms.uSandR.value = v;
        return;
      }
      if (param === 'scene' && (type === 'vertexMarkerY' || type === 'edgeMarkerY' || type === 'hexMarkerY')) {
        return; // applied live in animate loop per-marker
      } else if (param === 'scene' && type === 'tokenMetalness') {
        boardGroup.traverse(obj => {
          if (obj.isMesh && obj.material?.userData?.isTokenDisc) obj.material.metalness = v;
        });
        return;
      } else if (param === 'scene' && (type === 'sheepScale' || type === 'sheepY')) {
        sheepList.forEach(s => {
          if (type === 'sheepScale') s.mesh.scale.setScalar(SCENE_PARAMS.sheepScale / s.modelMaxDim);
          s.mesh.position.y = s.surfaceY + SCENE_PARAMS.sheepY;
        });
        return;
      } else if (param === 'scene' && (type === 'camelScale' || type === 'camelY')) {
        camelList.forEach(s => {
          if (type === 'camelScale') s.mesh.scale.setScalar(SCENE_PARAMS.camelScale / s.modelMaxDim);
          s.mesh.position.y = s.surfaceY + SCENE_PARAMS.camelY;
          s.mesh.userData.baseY = s.surfaceY + SCENE_PARAMS.camelY;
        });
        return;
      } else if (param === 'scene' && (type === 'settlementY' || type === 'castleY' || type === 'castleSize' || type === 'roadY')) {
        renderBuildings(gameState);
      } else if (param === 'numberY') {
        renderBoard(gameState);
        renderBuildings(gameState);
      } else {
        renderBoard(gameState);
        renderBuildings(gameState);
      }
    });
  });

  // Color inputs for token colours
  document.querySelectorAll('.token-color-input').forEach(input => {
    input.addEventListener('input', () => {
      const param = input.dataset.param;
      const type  = input.dataset.type;
      const v = parseInt(input.value.slice(1), 16);
      if (param === 'token') {
        if (type === 'token3dRed') SCENE_PARAMS.token3dRed = v;
        else if (type === 'token3dSilver') SCENE_PARAMS.token3dSilver = v;
        else if (type === 'token3dRingColor') SCENE_PARAMS.token3dRingColor = v;
        if (gameState) renderBoard(gameState);
      }
    });
  });
})();

// ─── Trade UI ─────────────────────────────────────────────────────────────────
const TRADE_RES = [
  { key:'wood',  icon:'🪵', name:'Wood'  },
  { key:'brick', icon:'🧱', name:'Brick' },
  { key:'sheep', icon:'🐑', name:'Sheep' },
  { key:'wheat', icon:'🌾', name:'Wheat' },
  { key:'ore',   icon:'🪨',  name:'Ore'   },
];

function buildResRow(containerId, countsObj, maxFn, onChange) {
  const row = document.getElementById(containerId);
  if (!row) return;
  row.innerHTML = '';
  TRADE_RES.forEach(({ key, icon, name }) => {
    const chip = document.createElement('div');
    chip.className = 'trade-res-chip';
    chip.innerHTML = `
      <div class="trc-icon">${icon}</div>
      <div class="trc-name">${name}</div>
      <div class="trc-controls">
        <button class="trc-btn trc-minus" data-key="${key}">−</button>
        <span class="trc-count" id="trc_${containerId}_${key}">0</span>
        <button class="trc-btn trc-plus"  data-key="${key}">+</button>
      </div>`;
    chip.querySelector('.trc-minus').addEventListener('click', () => {
      if ((countsObj[key]||0) > 0) { countsObj[key]--; refreshResRow(containerId, countsObj, maxFn); onChange(); }
    });
    chip.querySelector('.trc-plus').addEventListener('click', () => {
      const max = maxFn ? maxFn(key) : 99;
      if ((countsObj[key]||0) < max) { countsObj[key] = (countsObj[key]||0)+1; refreshResRow(containerId, countsObj, maxFn); onChange(); }
    });
    row.appendChild(chip);
  });
}

function refreshResRow(containerId, countsObj, maxFn) {
  // Determine which keys are in the *other* row so we can grey them out here
  const isGiveRow = containerId === 'tradeGiveRow';
  const otherCounts = isGiveRow ? tradeRecvCounts : tradeGiveCounts;

  TRADE_RES.forEach(({ key }) => {
    const span = document.getElementById(`trc_${containerId}_${key}`);
    if (span) span.textContent = countsObj[key] || 0;
    const row = document.getElementById(containerId);
    if (!row) return;
    const chip = row.querySelector(`.trc-plus[data-key="${key}"]`)?.closest('.trade-res-chip');
    const plus  = row.querySelector(`.trc-plus[data-key="${key}"]`);
    const minus = row.querySelector(`.trc-minus[data-key="${key}"]`);

    // Grey out if the other row already selected this resource
    const blockedByOther = (otherCounts[key] || 0) > 0;
    if (chip) chip.style.opacity = blockedByOther ? '0.35' : '';

    if (plus)  plus.disabled  = blockedByOther || (maxFn ? (countsObj[key]||0) >= maxFn(key) : false);
    if (minus) minus.disabled = blockedByOther || (countsObj[key]||0) <= 0;

    // If this resource is now blocked, reset its count to 0
    if (blockedByOther && (countsObj[key]||0) > 0) {
      countsObj[key] = 0;
      if (span) span.textContent = '0';
    }
  });
}

const tradeGiveCounts = {};
const tradeRecvCounts = {};
const tradeOfferCounts = {};
const tradeWantCounts  = {};

function getPortRatios() {
  if (!gameState) return {};
  const ratios = {};
  const me = gameState.players.find(p => p.id === myId);
  if (!me) return ratios;
  TRADE_RES.forEach(({ key }) => { ratios[key] = 4; });
  gameState.board.vertices.forEach(v => {
    if (v.building?.playerId !== myId) return;
    if (v.port && ratios[v.port] !== undefined) ratios[v.port] = Math.min(ratios[v.port], 2);
    else if (v.port === 'any') TRADE_RES.forEach(({ key }) => { ratios[key] = Math.min(ratios[key], 3); });
  });
  return ratios;
}

function updateBankTradeInfo() {
  if (!gameState) return;
  const me = gameState.players.find(p => p.id === myId);
  if (!me) return;
  const ratios = getPortRatios();
  const infoEl = document.getElementById('tradeRatioInfo');

  const giveTotal = TRADE_RES.reduce((s,{key}) => s+(tradeGiveCounts[key]||0), 0);
  const recvTotal = TRADE_RES.reduce((s,{key}) => s+(tradeRecvCounts[key]||0), 0);

  const bankBtn = document.getElementById('btnTradeConfirm');
  if (giveTotal === 0 && recvTotal === 0) {
    const parts = TRADE_RES.map(({key,icon}) => `${icon}${ratios[key]}:1`).join('  ');
    if (infoEl) infoEl.textContent = `Port ratios: ${parts}`;
    if (bankBtn) bankBtn.disabled = true;
    return;
  }

  // Show ratio hints and whether bank trade is valid
  const giveKeys = TRADE_RES.filter(({key}) => (tradeGiveCounts[key]||0) > 0);
  const recvKeys = TRADE_RES.filter(({key}) => (tradeRecvCounts[key]||0) > 0);

  if (giveKeys.length === 0 && recvKeys.length === 0) {
    const parts = TRADE_RES.map(({key,icon}) => `${icon}${ratios[key]}:1`).join('  ');
    if (infoEl) infoEl.textContent = `Your rates: ${parts}`;
    if (bankBtn) bankBtn.disabled = true;
    return;
  }

  const errors = [];
  let bankOk = giveKeys.length === 1 && recvKeys.length === 1;
  if (bankOk) {
    const gk = giveKeys[0].key, rk = recvKeys[0].key;
    if (gk === rk) { bankOk = false; errors.push('Give and receive must differ'); }
    else {
      const ratio = ratios[gk]; const n = tradeGiveCounts[gk];
      if (n !== ratio) { bankOk = false; errors.push(`Give exactly ${ratio}× ${giveKeys[0].icon}`); }
      else if ((me.resources[gk]||0) < n) { bankOk = false; errors.push(`Not enough ${giveKeys[0].icon}`); }
    }
  } else if (giveKeys.length > 1 || recvKeys.length > 1) {
    errors.push('Bank: one resource type at a time');
    bankOk = false;
  }
  if (infoEl) infoEl.textContent = errors.join(' · ');
  if (bankBtn) bankBtn.disabled = !bankOk;
}

function openTradeModal() {
  if (!gameState) return;
  const me = gameState.players.find(p => p.id === myId);
  if (!me) return;

  TRADE_RES.forEach(({ key }) => { tradeGiveCounts[key]=0; tradeRecvCounts[key]=0; });

  // Give max = port ratio (exactly one bank trade at a time) capped by what player has
  const ratios = getPortRatios();
  const giveFn = key => Math.min(ratios[key] || 4, me.resources[key] || 0);

  buildResRow('tradeGiveRow', tradeGiveCounts, giveFn, () => {
    refreshResRow('tradeGiveRow', tradeGiveCounts, giveFn);
    refreshResRow('tradeRecvRow', tradeRecvCounts, null);
    updateBankTradeInfo();
  });
  buildResRow('tradeRecvRow', tradeRecvCounts, null, () => {
    refreshResRow('tradeRecvRow', tradeRecvCounts, null);
    refreshResRow('tradeGiveRow', tradeGiveCounts, giveFn);
    updateBankTradeInfo();
  });

  refreshResRow('tradeGiveRow', tradeGiveCounts, giveFn);
  refreshResRow('tradeRecvRow', tradeRecvCounts, null);
  updateBankTradeInfo();
  updateTradePendingUI();

  const popup = document.getElementById('tradePanelPopup');
  if (popup) popup.style.display = 'block';
}

function updateResourceBar(me, state) {
  const bar = document.getElementById('myResourceBar');
  if (!bar) return;
  if (!me || state.status === 'lobby' || state.status === 'setup_forward' || state.status === 'setup_backward') {
    bar.style.display = 'none'; return;
  }
  bar.style.display = 'flex';
  bar.innerHTML = '';
  let total = 0;
  ['wood','brick','sheep','wheat','ore'].forEach(r => {
    const n = me.resources[r] || 0;
    total += n;
    const chip = document.createElement('div');
    chip.className = 'res-bar-chip';
    chip.title = `Click to give ${RES_EMOJI[r]} in trade`;
    chip.innerHTML = `<span class="rbc-icon">${RES_EMOJI[r]}</span><span class="rbc-count">${n}</span>`;
    chip.addEventListener('click', () => {
      if (!gameState) return;
      const curr = gameState.players[gameState.currentPlayerIndex];
      if (curr?.id !== myId || !gameState.diceRolled) return;
      // Add 1 to give row — open trade popup if needed
      const popup = document.getElementById('tradePanelPopup');
      if (popup) popup.style.display = 'block';
      const have = me.resources[r] || 0;
      const ratios = getPortRatios();
      const max = Math.min(ratios[r] || 4, have);
      if ((tradeGiveCounts[r] || 0) < max) {
        tradeGiveCounts[r] = (tradeGiveCounts[r] || 0) + 1;
        const giveFn = key => Math.min(ratios[key]||4, me.resources[key]||0);
        refreshResRow('tradeGiveRow', tradeGiveCounts, giveFn);
        refreshResRow('tradeRecvRow', tradeRecvCounts, null);
        updateBankTradeInfo();
      }
    });
    bar.appendChild(chip);
  });
  const totalBadge = document.createElement('div');
  totalBadge.className = 'res-bar-total';
  totalBadge.title = 'Total cards in hand';
  totalBadge.textContent = total;
  bar.appendChild(totalBadge);
}

function updateMyResourcesHand(state, me) {
  updateResourceBar(me, state);
}

function updateTradePanelIfOpen() {
  const popup = document.getElementById('tradePanelPopup');
  if (!popup || popup.style.display === 'none') return;
  if (!gameState) return;
  const me = gameState.players.find(p => p.id === myId);
  if (!me) return;
  const ratios2 = getPortRatios();
  refreshResRow('tradeGiveRow', tradeGiveCounts, key => Math.min(ratios2[key]||4, me.resources[key]||0));
  updateBankTradeInfo();
  updateTradePendingUI();
}

function updateTradePendingUI() {
  if (!gameState) return;
  const trade = gameState.pendingTrade;
  const proposePanel = document.getElementById('tradeProposePanel');
  const waitPanel = document.getElementById('tradeWaitPanel');
  if (!proposePanel || !waitPanel) return;

  if (trade && trade.fromId === myId) {
    proposePanel.style.display = 'none';
    waitPanel.style.display = 'flex';
    // Auto-open popup when we're proposing
    const popup = document.getElementById('tradePanelPopup');
    if (popup) popup.style.display = 'block';
    // Show offer summary so popup doesn't look empty
    const summaryEl = document.getElementById('tradeWaitSummary');
    if (summaryEl && trade.offer && trade.want) {
      const RES_ICONS = { wood:'🪵', sheep:'🐑', wheat:'🌾', brick:'🧱', ore:'⛏' };
      const fmt = obj => Object.entries(obj).filter(([,v])=>v>0).map(([r,v])=>`${RES_ICONS[r]||r}×${v}`).join(' ') || '—';
      summaryEl.innerHTML = `
        <div class="trade-bar-col"><div class="trade-section-label">YOU GIVE</div><div style="font-size:.9rem;padding:4px 0">${fmt(trade.offer)}</div></div>
        <div class="trade-popup-arrow">⟺</div>
        <div class="trade-bar-col"><div class="trade-section-label">YOU GET</div><div style="font-size:.9rem;padding:4px 0">${fmt(trade.want)}</div></div>`;
    }
    // Show responses
    const listEl = document.getElementById('tradeResponseList');
    if (listEl) {
      listEl.innerHTML = '';
      gameState.players.forEach(p => {
        if (p.id === myId) return;
        const resp = trade.responses?.[p.id];
        const isEmbargoed = embargoed.has(p.id);
        const item = document.createElement('div');
        item.className = 'trade-resp-item';
        if (isEmbargoed) {
          item.innerHTML = `<span class="trade-resp-name">${escapeHtml(p.name)}</span><span class="trade-resp-reject">🚫 Embargoed</span>`;
        } else if (resp?.status === 'accept') {
          item.innerHTML = `<span class="trade-resp-name">${escapeHtml(p.name)}</span><button class="trade-do-btn" data-pid="${escapeHtml(p.id)}">✓ Trade</button>`;
        } else if (resp?.status === 'reject') {
          item.innerHTML = `<span class="trade-resp-name">${escapeHtml(p.name)}</span><span class="trade-resp-reject">✗ Declined</span>`;
        } else if (trade.counteringId === p.id) {
          item.innerHTML = `<span class="trade-resp-name">${escapeHtml(p.name)}</span><span class="trade-resp-pending" style="color:#f0c040">✏ Countering…</span>`;
        } else {
          item.innerHTML = `<span class="trade-resp-name">${escapeHtml(p.name)}</span><span class="trade-resp-pending">…</span>`;
        }
        listEl.appendChild(item);
      });
      listEl.querySelectorAll('.trade-do-btn').forEach(btn => {
        btn.addEventListener('click', () => { socket.emit('selectPartner', { partnerId: btn.dataset.pid }); addTimerBonus(15); });
      });
    }
  } else {
    proposePanel.style.display = 'flex';
    waitPanel.style.display = 'none';
  }
}

function updateTradeIncoming(state) {
  const trade = state.pendingTrade;
  const el = document.getElementById('tradeIncoming');
  if (!el) return;

  // Don't show to proposer or if already declined
  if (!trade || trade.fromId === myId) { el.style.display = 'none'; return; }
  const myResp = trade.responses?.[myId];
  if (myResp?.status === 'reject' && !embargoed.has(trade.fromId)) { el.style.display = 'none'; return; }

  const isEmbargoedProposer = embargoed.has(trade.fromId);

  document.getElementById('tiProposerName').textContent = trade.fromName || 'Someone';

  function buildTiRow(containerId, counts) {
    const row = document.getElementById(containerId);
    if (!row) return;
    row.innerHTML = '';
    TRADE_RES.forEach(({ key, icon }) => {
      const n = counts[key]||0;
      if (n === 0) return;
      const chip = document.createElement('div');
      chip.className = 'ti-res-chip';
      chip.innerHTML = `<div class="trc-icon">${icon}</div><div class="trc-count">${n}</div>`;
      row.appendChild(chip);
    });
    if (!row.children.length) row.innerHTML = '<span style="color:var(--text-muted);font-size:.75rem">—</span>';
  }

  buildTiRow('tiOfferRow', trade.offer);
  buildTiRow('tiWantRow', trade.want);

  // Embargo inline lift — show trade but replace action buttons
  const tradeBtnRow = document.querySelector('#tradeIncoming .trade-btn-row');
  const counterBtn  = document.getElementById('btnCounteroffer');
  if (isEmbargoedProposer) {
    if (tradeBtnRow) tradeBtnRow.style.display = 'none';
    if (counterBtn)  counterBtn.style.display  = 'none';
    let liftRow = document.getElementById('tiLiftEmbargoRow');
    if (!liftRow) {
      liftRow = document.createElement('div');
      liftRow.id = 'tiLiftEmbargoRow';
      liftRow.style.cssText = 'text-align:center;margin-top:8px;';
      liftRow.innerHTML = `<button id="btnLiftEmbargo" style="background:rgba(255,200,0,0.15);border:1px solid rgba(255,200,0,0.4);color:#ffd700;border-radius:8px;padding:7px 14px;cursor:pointer;font-size:.82rem;">🚫 Lift Embargo to Accept</button>`;
      el.querySelector('.trade-incoming-card').appendChild(liftRow);
      document.getElementById('btnLiftEmbargo').addEventListener('click', () => {
        embargoed.delete(trade.fromId);
        updateTradeIncoming(state);
      });
    }
    liftRow.style.display = 'block';
  } else {
    const liftRow = document.getElementById('tiLiftEmbargoRow');
    if (liftRow) liftRow.style.display = 'none';
    if (tradeBtnRow) tradeBtnRow.style.display = '';
    if (counterBtn)  counterBtn.style.display  = '';
    // Check if we can afford what they want
    const me = state.players.find(p => p.id === myId);
    const canAffordIt = me && TRADE_RES.every(({key}) => (trade.want[key]||0) <= (me.resources[key]||0));
    const acceptBtn = document.getElementById('btnTradeAccept');
    if (acceptBtn) { acceptBtn.disabled = !canAffordIt; acceptBtn.title = canAffordIt ? '' : 'Not enough resources'; }
  }

  // Counteroffer thinking banner
  let coNotice = document.getElementById('tiCoNotice');
  if (!coNotice) {
    coNotice = document.createElement('div');
    coNotice.id = 'tiCoNotice';
    coNotice.style.cssText = 'text-align:center;font-size:.78rem;color:#f0c040;margin-top:6px;font-style:italic;';
    el.querySelector('.trade-incoming-card').appendChild(coNotice);
  }
  if (trade.counteringId && trade.counteringId !== myId && !trade.responses?.[trade.counteringId]) {
    coNotice.textContent = `✏ ${escapeHtml(trade.counteringName || '?')} is writing a counteroffer…`;
    coNotice.style.display = 'block';
  } else {
    coNotice.style.display = 'none';
  }

  // Show other players' responses
  const otherEl = document.getElementById('tiOtherResponses');
  if (otherEl) {
    const others = state.players.filter(p => p.id !== myId && p.id !== trade.fromId);
    if (others.length) {
      otherEl.style.display = 'block';
      otherEl.innerHTML = others.map(p => {
        const r = trade.responses?.[p.id];
        const isCountering = trade.counteringId === p.id && !r;
        const icon  = isCountering ? '✏' : r?.status === 'accept' ? '✓' : r?.status === 'reject' ? '✗' : '…';
        const color = isCountering ? '#f0c040' : r?.status === 'accept' ? '#2ecc71' : r?.status === 'reject' ? '#e74c3c' : 'rgba(255,255,255,0.4)';
        return `<span style="margin-right:8px;color:${color}">${icon} ${escapeHtml(p.name)}</span>`;
      }).join('');
    } else {
      otherEl.style.display = 'none';
    }
  }

  el.style.display = 'block';
}

// Open trade popup when clicking the hand trade button
document.getElementById('btnOpenTrade').addEventListener('click', () => {
  openTradeModal();
});

// Close trade popup
document.getElementById('btnTradeClose').addEventListener('click', () => {
  const popup = document.getElementById('tradePanelPopup');
  if (popup) popup.style.display = 'none';
});

// Also close via cancel button
document.getElementById('btnTradeCancel').addEventListener('click', () => {
  TRADE_RES.forEach(({ key }) => { tradeGiveCounts[key]=0; tradeRecvCounts[key]=0; });
  const popup = document.getElementById('tradePanelPopup');
  if (popup) popup.style.display = 'none';
});

document.getElementById('btnTradeCancelProp').addEventListener('click', () => {
  socket.emit('cancelTrade');
});

document.getElementById('btnTradeConfirm').addEventListener('click', () => {
  const ratios = getPortRatios();
  const giveEntries = TRADE_RES.filter(({key}) => (tradeGiveCounts[key]||0) > 0);
  const recvEntries = TRADE_RES.filter(({key}) => (tradeRecvCounts[key]||0) > 0);
  if (!giveEntries.length || !recvEntries.length) { alert('Select what to give and receive'); return; }
  if (giveEntries.length > 1 || recvEntries.length > 1) { alert('Bank trades one resource type at a time'); return; }
  const giveRes = giveEntries[0].key;
  const recvRes = recvEntries[0].key;
  if (giveRes === recvRes) { alert('Give and receive must differ'); return; }
  const ratio = ratios[giveRes];
  const n = tradeGiveCounts[giveRes];
  if (n !== ratio) { alert(`Need exactly ${ratio} ${giveRes} to trade`); return; }
  socket.emit('tradeBank', { give: giveRes, receive: recvRes });
  addTimerBonus(15);
});

document.getElementById('btnTradePropose').addEventListener('click', () => {
  const offer = {}, want = {};
  TRADE_RES.forEach(({ key }) => {
    if (tradeGiveCounts[key]>0) offer[key] = tradeGiveCounts[key];
    if (tradeRecvCounts[key]>0) want[key]  = tradeRecvCounts[key];
  });
  if (!Object.keys(offer).length || !Object.keys(want).length) { alert('Select what to give and receive'); return; }
  socket.emit('proposeTrade', { offer, want, excludedIds: [...embargoed] });
  addTimerBonus(15);
});

document.getElementById('btnTradeAccept').addEventListener('click', () => {
  socket.emit('respondTrade', { accept: true });
  document.getElementById('tradeIncoming').style.display = 'none';
});
document.getElementById('btnTradeReject').addEventListener('click', () => {
  socket.emit('respondTrade', { accept: false });
  document.getElementById('tradeIncoming').style.display = 'none';
});

// ── Counteroffer ──────────────────────────────────────────────────────────────
const coGive = { wood:0, brick:0, sheep:0, wheat:0, ore:0 };
const coWant = { wood:0, brick:0, sheep:0, wheat:0, ore:0 };

function openCounteroffer() {
  if (!gameState?.pendingTrade) return;
  const trade = gameState.pendingTrade;
  const me = gameState.players.find(p => p.id === myId);
  // Pre-fill: reverse of current trade (they wanted X from me → I want X back; they offer Y → I give Y)
  TRADE_RES.forEach(({key}) => {
    coGive[key] = trade.want[key] || 0;
    coWant[key] = trade.offer[key] || 0;
  });
  renderCoRows(me);
  document.getElementById('counterofferModal').style.display = 'flex';
}

function renderCoRows(me) {
  const container = document.getElementById('coOfferRows');
  container.innerHTML = '';
  const myRes = me?.resources || {};
  TRADE_RES.forEach(({key, icon, name}) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:.9rem;';
    row.innerHTML = `
      <span style="font-size:1.2rem;width:26px;text-align:center">${icon}</span>
      <span style="flex:1;color:rgba(255,255,255,0.7)">${name}</span>
      <span style="font-size:.75rem;color:rgba(255,255,255,0.4)">have:${myRes[key]||0}</span>
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
        <span style="font-size:.65rem;color:rgba(255,255,255,0.4)">Give</span>
        <div style="display:flex;align-items:center;gap:4px">
          <button data-res="${key}" data-side="give" data-d="-1" class="co-btn">−</button>
          <span id="co-give-${key}" style="min-width:18px;text-align:center">${coGive[key]}</span>
          <button data-res="${key}" data-side="give" data-d="1" class="co-btn">+</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
        <span style="font-size:.65rem;color:rgba(255,255,255,0.4)">Receive</span>
        <div style="display:flex;align-items:center;gap:4px">
          <button data-res="${key}" data-side="want" data-d="-1" class="co-btn">−</button>
          <span id="co-want-${key}" style="min-width:18px;text-align:center">${coWant[key]}</span>
          <button data-res="${key}" data-side="want" data-d="1" class="co-btn">+</button>
        </div>
      </div>`;
    container.appendChild(row);
  });
  container.querySelectorAll('.co-btn').forEach(btn => {
    btn.style.cssText = 'width:22px;height:22px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;cursor:pointer;font-size:.9rem;line-height:1;';
    btn.addEventListener('click', () => {
      const res = btn.dataset.res, side = btn.dataset.side, d = parseInt(btn.dataset.d);
      const obj = side === 'give' ? coGive : coWant;
      const myHas = me?.resources?.[res] || 0;
      obj[res] = Math.max(0, Math.min(side === 'give' ? myHas : 10, obj[res] + d));
      document.getElementById(`co-${side}-${res}`).textContent = obj[res];
    });
  });
}

document.getElementById('btnCounteroffer').addEventListener('click', () => {
  socket.emit('notifyCountering');
  openCounteroffer();
});

document.getElementById('btnCoCancel').addEventListener('click', () => {
  document.getElementById('counterofferModal').style.display = 'none';
});

document.getElementById('btnCoSend').addEventListener('click', () => {
  const offer = {}, want = {};
  let hasOffer = false, hasWant = false;
  TRADE_RES.forEach(({key}) => {
    if (coGive[key] > 0) { offer[key] = coGive[key]; hasOffer = true; }
    if (coWant[key] > 0) { want[key]  = coWant[key]; hasWant  = true; }
  });
  if (!hasOffer || !hasWant) return;
  // Decline current trade first, then propose the counter
  socket.emit('respondTrade', { accept: false });
  socket.emit('proposeTrade', { offer, want, excludedIds: [...embargoed] });
  addTimerBonus(15);
  document.getElementById('counterofferModal').style.display = 'none';
  document.getElementById('tradeIncoming').style.display = 'none';
});

document.getElementById('btnDevBuy').addEventListener('click', () => { socket.emit('buyDevCard'); addTimerBonus(15); });

document.getElementById('btnDevPlay').addEventListener('click', () => {
  if (!gameState) return;
  const me = gameState.players.find(p => p.id === myId); if (!me) return;
  const list = document.getElementById('devCardList'); list.innerHTML = '';
  const DEV_INFO = {
    knight:       { label: '⚔ Knight',          desc: 'Move the robber & steal 1 resource' },
    roadBuilding: { label: '🛣 Road Building',   desc: 'Place 2 roads for free' },
    yearOfPlenty: { label: '🌟 Year of Plenty',  desc: 'Take any 2 resources from the bank' },
    monopoly:     { label: '💰 Monopoly',        desc: 'Steal all of one resource from everyone' },
  };
  let anyShown = false;
  me.devCards.forEach((card, i) => {
    if (card.type === 'hidden' || card.type === 'vp') return;
    const info = DEV_INFO[card.type];
    if (!info) return;
    anyShown = true;
    const btn = document.createElement('button');
    btn.className = 'dev-card-btn';
    btn.disabled = card.played || card.newThisTurn || gameState.devCardPlayed;
    btn.innerHTML = `<span class="dcb-label">${info.label}</span><span class="dcb-desc">${info.desc}</span>`;
    if (card.newThisTurn) btn.title = 'Cannot play a card bought this turn';
    else if (gameState.devCardPlayed) btn.title = 'Already played a dev card this turn';
    btn.addEventListener('click', () => {
      document.getElementById('devModal').style.display = 'none';
      playDevCard(i, card.type);
    });
    list.appendChild(btn);
  });
  if (!anyShown) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:8px">No playable cards</div>';
  }
  document.getElementById('devModal').style.display = 'flex';
});
document.getElementById('btnDevCancel').addEventListener('click', () => document.getElementById('devModal').style.display='none');

function playDevCard(idx, type) {
  const resOpts = '<option value="wood">🪵 Wood</option><option value="brick">🧱 Brick</option><option value="sheep">🐑 Sheep</option><option value="wheat">🌾 Wheat</option><option value="ore">🪨 Ore</option>';
  if (type === 'knight') {
    socket.emit('playDevCard', { cardIndex: idx, params: {} }); addTimerBonus(15);
    // Server will set status='robber'; updateUI will auto-enter robber build mode
    return;
  }
  if (type === 'roadBuilding') {
    socket.emit('playDevCard', { cardIndex: idx, params: {} }); addTimerBonus(15);
    // Server sets freeRoads=2; updateUI will auto-enter road build mode
    return;
  }
  if (type === 'yearOfPlenty') {
    showParamModal('Year of Plenty — Choose 2 Resources',
      `<label>First resource</label><select id="yp1">${resOpts}</select>
       <label>Second resource</label><select id="yp2">${resOpts}</select>`,
      () => { socket.emit('playDevCard', { cardIndex: idx, params: { res1: document.getElementById('yp1').value, res2: document.getElementById('yp2').value } }); addTimerBonus(15); });
    return;
  }
  if (type === 'monopoly') {
    showParamModal('Monopoly — Steal All Of One Type',
      `<label>Resource to monopolize</label><select id="mono">${resOpts}</select>`,
      () => { socket.emit('playDevCard', { cardIndex: idx, params: { resource: document.getElementById('mono').value } }); addTimerBonus(15); });
    return;
  }
}

function showParamModal(title, html, onOk) {
  document.getElementById('paramTitle').textContent=title;
  document.getElementById('paramFields').innerHTML=html;
  document.getElementById('paramModal').style.display='flex';
  document.getElementById('btnParamOk').onclick=()=>{ onOk(); document.getElementById('paramModal').style.display='none'; };
}
document.getElementById('btnParamCancel').addEventListener('click', ()=>document.getElementById('paramModal').style.display='none');
document.getElementById('btnReload').addEventListener('click', ()=>location.reload());

// ─── Discard Modal ────────────────────────────────────────────────────────────
let _discardCounts = {};
let _discardNeeded = 0;

let _discardResources = {};

function openDiscardModal(needed, myResources) {
  _discardNeeded = needed;
  _discardCounts = {};
  _discardResources = myResources;
  const modal = document.getElementById('discardModal');
  document.getElementById('discardTitle').textContent = 'Discard Cards';
  document.getElementById('discardSubtitle').textContent = `7 was rolled. You must discard ${needed} card${needed!==1?'s':''}.`;
  document.getElementById('discardNeeded').textContent = needed;
  const rows = document.getElementById('discardRows');
  rows.innerHTML = '';
  TRADE_RES.forEach(({ key, icon }) => {
    const have = myResources[key] || 0;
    if (!have) return;
    _discardCounts[key] = 0;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px';
    row.dataset.key = key;
    row.innerHTML = `
      <span style="font-size:1.4rem">${icon}</span>
      <button class="btn btn-secondary" data-key="${key}" data-dir="-1" style="padding:2px 10px;font-size:1rem">−</button>
      <span class="discard-count" data-key="${key}" style="min-width:22px;text-align:center;font-weight:bold;font-size:1.1rem">0</span>
      <button class="btn btn-secondary" data-key="${key}" data-dir="1" style="padding:2px 10px;font-size:1rem">+</button>
      <span class="discard-have" data-key="${key}" style="margin-left:4px;font-size:.85rem;color:var(--text-muted)">/ ${have}</span>
    `;
    rows.appendChild(row);
  });
  rows.querySelectorAll('button[data-dir]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      const dir = parseInt(btn.dataset.dir);
      const have = _discardResources[key] || 0;
      _discardCounts[key] = Math.max(0, Math.min(have, (_discardCounts[key]||0) + dir));
      updateDiscardCount();
    });
  });
  updateDiscardCount();
  modal.style.display = 'flex';
}

function updateDiscardCount() {
  const total = Object.values(_discardCounts).reduce((a,b)=>a+b,0);
  document.getElementById('discardCount').textContent = total;
  TRADE_RES.forEach(({key}) => {
    const countEl = document.querySelector(`.discard-count[data-key="${key}"]`);
    const haveEl  = document.querySelector(`.discard-have[data-key="${key}"]`);
    const have = _discardResources[key] || 0;
    const selected = _discardCounts[key] || 0;
    const remaining = have - selected;
    if (countEl) countEl.textContent = selected;
    if (haveEl)  haveEl.textContent  = `/ ${remaining}`;
    // Grey out + when at max, − when at 0
    const plusBtn  = document.querySelector(`button[data-key="${key}"][data-dir="1"]`);
    const minusBtn = document.querySelector(`button[data-key="${key}"][data-dir="-1"]`);
    if (plusBtn)  plusBtn.disabled  = selected >= have;
    if (minusBtn) minusBtn.disabled = selected <= 0;
  });
  document.getElementById('btnDiscardConfirm').disabled = total !== _discardNeeded;
}

document.getElementById('btnDiscardConfirm').addEventListener('click', () => {
  const cards = {};
  Object.entries(_discardCounts).forEach(([k,v]) => { if (v > 0) cards[k] = v; });
  socket.emit('discardCards', { cards });
  document.getElementById('discardModal').style.display = 'none';
});

// Chat
document.getElementById('btnChatSend').addEventListener('click', sendChat);
document.getElementById('chatInput').addEventListener('keydown', e => { if (e.key==='Enter') sendChat(); });

// Mic
document.getElementById('btnMicToggle').addEventListener('click', async () => {
  const btn = document.getElementById('btnMicToggle');
  if (!voiceChat.micOn) {
    btn.textContent='🎤 Connecting…'; btn.disabled=true;
    await voiceChat.enableMic();
    btn.disabled=false;
    if (voiceChat.micOn) { btn.textContent='🎤 On'; btn.className='mic-btn on'; }
    else { btn.textContent='🎤 Off'; btn.className='mic-btn off'; }
  } else {
    voiceChat.disableMic();
    btn.textContent='🎤 Off'; btn.className='mic-btn off';
  }
});

// ─── Music player ────────────────────────────────────────────────────────────
AUDIO.musicVolume = 0.01;
AUDIO.musicMuted  = false;
{
  const TRACKS = [
    'Music/Adam Dib - Still We Rise.mp3',
    'Music/Bara Matahari Pagi - A Clash Among the Stars.mp3',
    'Music/Bara Matahari Pagi - Voyage to the Unknown.mp3',
    'Music/Kyle Preston - Hall of the Elders.mp3',
    'Music/Linus Johnsson - The Children of the Woods.mp3',
  ];
  const FADE_DURATION = 10;
  let trackIdx = 0;
  let activeAudio = null;
  let fadingAudio = null;
  let fadeInterval = null;
  function musicVol() { return AUDIO.musicMuted ? 0 : AUDIO.musicVolume; }

  function trackName(path) { return path.replace(/^.*\//, '').replace(/\.mp3$/i, ''); }
  function setTitle(path) {
    const el = document.getElementById('musicTitle');
    if (el) el.textContent = trackName(path);
  }

  function startFade(from, to) {
    clearInterval(fadeInterval);
    const steps = 60;
    const interval = (FADE_DURATION * 1000) / steps;
    let step = 0;
    fadeInterval = setInterval(() => {
      step++;
      const p = step / steps;
      if (from) from.volume = Math.max(0, (1 - p) * musicVol());
      if (to)   to.volume   = Math.min(1, p * musicVol());
      if (step >= steps) { clearInterval(fadeInterval); if (from) { from.pause(); from.src = ''; } }
    }, interval);
  }

  function playNext() {
    trackIdx = (trackIdx + 1) % TRACKS.length;
    const path = TRACKS[trackIdx];
    setTitle(path);
    const next = new Audio(path);
    next.volume = 0;
    next.play().catch(() => {});
    next.addEventListener('ended', playNext);
    fadingAudio = activeAudio;
    activeAudio = next;
    startFade(fadingAudio, activeAudio);
  }

  function startMusic() {
    if (activeAudio) return;
    trackIdx = Math.floor(Math.random() * TRACKS.length);
    const path = TRACKS[trackIdx];
    setTitle(path);
    const audio = new Audio(path);
    // Start silent and fade up over 10 seconds
    audio.volume = 0;
    audio.play().catch(() => {});
    audio.addEventListener('ended', playNext);
    activeAudio = audio;
    const target = musicVol();
    const FADE_IN = 10; // seconds
    const steps = 80;
    let step = 0;
    const fadeInInterval = setInterval(() => {
      step++;
      audio.volume = Math.min(target, (step / steps) * target);
      if (step >= steps) clearInterval(fadeInInterval);
    }, (FADE_IN * 1000) / steps);
    audio.addEventListener('timeupdate', () => {
      if (audio.duration && audio.currentTime >= audio.duration - FADE_DURATION && !fadingAudio) playNext();
    });
  }

  // Store apply function on AUDIO so settings panel can call it
  AUDIO.applyMusicVolume = () => {
    if (activeAudio) activeAudio.volume = musicVol();
    if (fadingAudio) fadingAudio.volume = AUDIO.musicMuted ? 0 : 0;
  };

  function onFirstInteract() {
    document.removeEventListener('click', onFirstInteract);
    document.removeEventListener('touchstart', onFirstInteract);
    document.removeEventListener('keydown', onFirstInteract);
    // Start music immediately, don't wait for voice over
    startMusic();
    // Play voice over in parallel (best effort)
    const vo = new Audio('voice over/Ej hekje leire.mp3');
    vo.volume = voVol();
    vo.play().catch(() => {});
  }
  document.addEventListener('click', onFirstInteract);
  document.addEventListener('touchstart', onFirstInteract);
  document.addEventListener('keydown', onFirstInteract);

  // Legacy music-row controls (kept in right panel for track title display)
  const btnMute = document.getElementById('btnMusicMute');
  const volSlider = document.getElementById('musicVolume');
  btnMute?.addEventListener('click', () => {
    AUDIO.musicMuted = !AUDIO.musicMuted;
    btnMute.textContent = AUDIO.musicMuted ? '🔇' : '🔊';
    btnMute.className = AUDIO.musicMuted ? 'mic-btn off' : 'mic-btn on';
    AUDIO.applyMusicVolume();
    // Sync settings panel mute button if present
    const sb = document.getElementById('audioMusicMute');
    if (sb) { sb.textContent = AUDIO.musicMuted ? '🔇' : '🔊'; sb.classList.toggle('off', AUDIO.musicMuted); sb.classList.toggle('on', !AUDIO.musicMuted); }
    const sv = document.getElementById('audioMusicVol');
    if (sv) updateSliderFill(sv);
  });
  volSlider?.addEventListener('input', () => {
    AUDIO.musicVolume = parseFloat(volSlider.value);
    updateSliderFill(volSlider);
    AUDIO.applyMusicVolume();
    const sv = document.getElementById('audioMusicVol');
    if (sv) { sv.value = AUDIO.musicVolume; updateSliderFill(sv); }
  });
}

// ─── Audio settings panel wiring ─────────────────────────────────────────────
function updateSliderFill(el) {
  const pct = (parseFloat(el.value) - parseFloat(el.min)) / (parseFloat(el.max) - parseFloat(el.min)) * 100;
  el.style.background = `linear-gradient(to right,rgba(255,255,255,.6) 0%,rgba(255,255,255,.6) ${pct}%,rgba(255,255,255,.15) ${pct}%)`;
}
{

  function wireAudioRow(muteId, volId, getMuted, setMuted, getVol, setVol, onApply) {
    const btn = document.getElementById(muteId);
    const sld = document.getElementById(volId);
    if (!btn || !sld) return;
    sld.value = getVol();
    updateSliderFill(sld);
    btn.addEventListener('click', () => {
      setMuted(!getMuted());
      btn.textContent = getMuted() ? '🔇' : '🔊';
      btn.classList.toggle('off', getMuted());
      btn.classList.toggle('on', !getMuted());
      onApply();
    });
    sld.addEventListener('input', () => {
      setVol(parseFloat(sld.value));
      updateSliderFill(sld);
      onApply();
    });
  }

  wireAudioRow(
    'audioSfxMute', 'audioSfxVol',
    () => AUDIO.sfxMuted,  v => { AUDIO.sfxMuted = v; },
    () => AUDIO.sfxVolume, v => { AUDIO.sfxVolume = v; },
    applyAudioParams
  );
  wireAudioRow(
    'audioVoMute', 'audioVoVol',
    () => AUDIO.voMuted,  v => { AUDIO.voMuted = v; },
    () => AUDIO.voVolume, v => { AUDIO.voVolume = v; },
    () => {} // voice-over plays once; volume applied next time it plays
  );
  wireAudioRow(
    'audioVcMute', 'audioVcVol',
    () => AUDIO.vcMuted,  v => { AUDIO.vcMuted = v; },
    () => AUDIO.vcVolume, v => { AUDIO.vcVolume = v; },
    applyVcVolume
  );
  wireAudioRow(
    'audioMusicMute', 'audioMusicVol',
    () => AUDIO.musicMuted,  v => { AUDIO.musicMuted = v; },
    () => AUDIO.musicVolume, v => { AUDIO.musicVolume = v; },
    () => {
      AUDIO.applyMusicVolume?.();
      // Sync legacy musicRow controls
      const btn2 = document.getElementById('btnMusicMute');
      const sld2 = document.getElementById('musicVolume');
      if (btn2) { btn2.textContent = AUDIO.musicMuted ? '🔇' : '🔊'; btn2.className = AUDIO.musicMuted ? 'mic-btn off' : 'mic-btn on'; }
      if (sld2) { sld2.value = AUDIO.musicVolume; updateSliderFill(sld2); }
    }
  );
}

// ─── Resize ───────────────────────────────────────────────────────────────────
function resize() {
  const wrap = document.getElementById('canvasWrapper');
  const w = wrap ? wrap.clientWidth  : window.innerWidth;
  const h = wrap ? wrap.clientHeight : window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.resolution.set(w, h);
  _outlinePasses.forEach(o => o.pass.resolution.set(w, h));
  _portOutlinePass.resolution.set(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ─── Animation loop ───────────────────────────────────────────────────────────
let t = 0;
// ─── Animal wander helpers (module-level constants, reused every frame) ───────
const _HEX_WANDER_MAX   = 0.48 * HEX_R;
const _HEX_WANDER_MIN   = HEX_R * 0.27 * 1.20;
const _HEX_WANDER_RANGE = _HEX_WANDER_MAX - _HEX_WANDER_MIN;
const _ARRIVE_SQ        = 0.0025; // (0.05)^2 — squared arrival threshold

function wanderAnimal(s, delta, baseYOffset, bobAmp) {
  const dx = s.tx - s.mesh.position.x;
  const dz = s.tz - s.mesh.position.z;
  const dist2 = dx*dx + dz*dz;
  if (dist2 < _ARRIVE_SQ) {
    const a = Math.random() * Math.PI * 2;
    const r = _HEX_WANDER_MIN + Math.random() * _HEX_WANDER_RANGE;
    s.tx = s.cx + Math.cos(a) * r;
    s.tz = s.cz + Math.sin(a) * r;
  } else {
    const dist = Math.sqrt(dist2);
    s.mesh.rotation.y = Math.atan2(dx, dz);
    s.mesh.position.x += (dx / dist) * s.speed * delta;
    s.mesh.position.z += (dz / dist) * s.speed * delta;
    const pdx = s.mesh.position.x - s.cx;
    const pdz = s.mesh.position.z - s.cz;
    const pd2 = pdx*pdx + pdz*pdz;
    if (pd2 > _HEX_WANDER_MAX * _HEX_WANDER_MAX) {
      const pd = Math.sqrt(pd2);
      s.mesh.position.x = s.cx + (pdx / pd) * _HEX_WANDER_MAX;
      s.mesh.position.z = s.cz + (pdz / pd) * _HEX_WANDER_MAX;
    } else if (pd2 < _HEX_WANDER_MIN * _HEX_WANDER_MIN) {
      const pd = pd2 < 1e-6 ? _HEX_WANDER_MIN : Math.sqrt(pd2);
      const nx = pd2 < 1e-6 ? 1 : pdx / pd;
      const nz = pd2 < 1e-6 ? 0 : pdz / pd;
      s.mesh.position.x = s.cx + nx * _HEX_WANDER_MIN;
      s.mesh.position.z = s.cz + nz * _HEX_WANDER_MIN;
      const ta = Math.atan2(nz, nx);
      s.tx = s.cx + Math.cos(ta) * (_HEX_WANDER_MIN + Math.random() * _HEX_WANDER_RANGE);
      s.tz = s.cz + Math.sin(ta) * (_HEX_WANDER_MIN + Math.random() * _HEX_WANDER_RANGE);
    }
  }
  s.bobT += s.bobSpeed * delta;
  s.mesh.position.y = s.surfaceY + baseYOffset + Math.abs(Math.sin(s.bobT)) * bobAmp;
}

// Pre-allocated vectors to avoid GC pressure in the animate loop
const _animWorldPos = new THREE.Vector3();
const _animToCam = new THREE.Vector3();
const _animSeenHids = new Set();

// FPS counter
const _fpsEl = document.getElementById('fpsCounter');
let _fpsFrames = 0, _fpsLast = performance.now();
function _updateFPS() {
  _fpsFrames++;
  const now = performance.now();
  if (now - _fpsLast >= 500) {
    const fps = Math.round(_fpsFrames * 1000 / (now - _fpsLast));
    if (_fpsEl) _fpsEl.textContent = fps + ' fps';
    _fpsFrames = 0;
    _fpsLast = now;
  }
}

// Mobile frame throttle: skip every other frame to target ~30fps
let _mobileFrameSkip = false;
function animate() {
  requestAnimationFrame(animate);
  if (_isMobile) {
    _mobileFrameSkip = !_mobileFrameSkip;
    if (_mobileFrameSkip) return;
  }
  const delta = clock.getDelta();
  t += delta;

  controls.update();

  // Marker pulse + live Y offset per marker type
  markerGroup.children.forEach((m, i) => {
    if (m.userData.baseY !== undefined) {
      const yOff = m.userData.markerType === 'vertex' ? SCENE_PARAMS.vertexMarkerY :
                   m.userData.markerType === 'edge'   ? SCENE_PARAMS.edgeMarkerY   :
                   m.userData.markerType === 'hex'    ? SCENE_PARAMS.hexMarkerY    : 0;
      m.position.y = m.userData.baseY + yOff;
    }
    if (m === pendingMarkerMesh) {
      if (m.material?.emissiveIntensity !== undefined) m.material.emissiveIntensity = 0.8 + 0.2 * Math.sin(t * 8);
      m.scale.setScalar(1.5 + 0.1 * Math.sin(t * 8));
    } else {
      if (m.material?.emissiveIntensity !== undefined) m.material.emissiveIntensity = 0.3 + 0.25 * Math.sin(t*3 + i*0.8);
    }
  });

  // Drop animations — pieces falling from sky
  for (let i = dropAnims.length - 1; i >= 0; i--) {
    const da = dropAnims[i];
    da.t += delta / DROP_DURATION;
    if (da.t >= 1) {
      da.t = 1;
      da.mesh.position.y = da.targetY;
      if (da.onLand) { da.onLand(); da.onLand = null; }
      dropAnims.splice(i, 1);
    } else {
      // Ease-in quad (accelerates like gravity)
      const ease = da.t * da.t;
      da.mesh.position.y = da.targetY + DROP_HEIGHT * (1 - ease);
    }
  }

  // Port bobbing (includes rise-from-water offset during intro)
  const portGroups = boardGroup.userData.portGroups;
  if (portGroups) {
    const riseOff = boardGroup.userData._portRiseOff ?? 0;
    portGroups.forEach(pg => {
      pg.position.y = pg.userData.baseY + riseOff + Math.sin(t * 0.9 + pg.userData.bobPhase) * 0.011;
    });
  }

  // Sheep/camel wandering — skip on mobile
  if (!_isMobile) {
  for (let i = 0; i < camelList.length; i++) wanderAnimal(camelList[i], delta, SCENE_PARAMS.camelY, 0.012);
  }

  if (!_isMobile) sheepList.forEach(s => {
    const dx = s.tx - s.mesh.position.x;
    const dz = s.tz - s.mesh.position.z;
    const dist2 = dx*dx + dz*dz;
    if (dist2 < _ARRIVE_SQ) {
      // Pick new target in annular zone between token radius and hex boundary
      const a = Math.random() * Math.PI * 2;
      const r = _HEX_WANDER_MIN + Math.random() * _HEX_WANDER_RANGE;
      s.tx = s.cx + Math.cos(a) * r;
      s.tz = s.cz + Math.sin(a) * r;
    } else {
      // Face and walk toward target
      const dist = Math.sqrt(dist2);
      s.mesh.rotation.y = Math.atan2(dx, dz);
      s.mesh.position.x += (dx / dist) * s.speed * delta;
      s.mesh.position.z += (dz / dist) * s.speed * delta;
      // Clamp position to hex boundary and push out of token inner zone
      const pdx = s.mesh.position.x - s.cx;
      const pdz = s.mesh.position.z - s.cz;
      const pd2 = pdx*pdx + pdz*pdz;
      const maxR2 = _HEX_WANDER_MAX * _HEX_WANDER_MAX;
      const minR2 = _HEX_WANDER_MIN * _HEX_WANDER_MIN;
      if (pd2 > maxR2) {
        const pd = Math.sqrt(pd2);
        s.mesh.position.x = s.cx + (pdx / pd) * _HEX_WANDER_MAX;
        s.mesh.position.z = s.cz + (pdz / pd) * _HEX_WANDER_MAX;
      } else if (pd2 < minR2) {
        const pd = pd2 < 0.000001 ? _HEX_WANDER_MIN : Math.sqrt(pd2);
        const nx = pd2 < 0.000001 ? 1 : pdx / pd;
        const nz = pd2 < 0.000001 ? 0 : pdz / pd;
        s.mesh.position.x = s.cx + nx * _HEX_WANDER_MIN;
        s.mesh.position.z = s.cz + nz * _HEX_WANDER_MIN;
        // Redirect wander target outward too
        const ta = Math.atan2(nz, nx);
        const tr = _HEX_WANDER_MIN + Math.random() * _HEX_WANDER_RANGE;
        s.tx = s.cx + Math.cos(ta) * tr;
        s.tz = s.cz + Math.sin(ta) * tr;
      }
    }
    // Bob up and down slightly while walking
    s.bobT += s.bobSpeed * delta;
    s.mesh.position.y = s.surfaceY + SCENE_PARAMS.sheepY + Math.abs(Math.sin(s.bobT)) * 0.015;
  });

  // Dust particles update
  for (let i = dustParticles.length - 1; i >= 0; i--) {
    const dp = dustParticles[i];
    dp.t += delta;
    const progress = dp.t / dp.duration;
    if (progress >= 1) {
      dustGroup.remove(dp.mesh);
      dp.mesh.geometry.dispose(); dp.mesh.material.dispose();
      dustParticles.splice(i, 1);
    } else {
      dp.mesh.position.x += dp.vx * delta;
      dp.mesh.position.y += dp.vy * delta - 4 * dp.t * delta; // gravity
      dp.mesh.position.z += dp.vz * delta;
      dp.mesh.material.opacity = 0.85 * (1 - progress);
    }
  }

  // Water ring particles (from tile intro splashes)
  for (let i = waterRings.length - 1; i >= 0; i--) {
    const wr = waterRings[i];
    wr.t += delta;
    const p = wr.t / wr.duration;
    if (p >= 1) {
      scene.remove(wr.mesh);
      wr.mesh.geometry.dispose(); wr.mesh.material.dispose();
      waterRings.splice(i, 1);
    } else {
      wr.mesh.scale.setScalar(1 + p * 5);
      wr.mesh.material.opacity = WATER_SPRITE_PARAMS.opacity * (1 - p);
    }
  }

  // ── Token intro: tokens fall from sky in spiral order ────────────────────────
  if (tokenIntro.active) {
    tokenIntro.t += delta;
    const FALL_DUR = 0.4;
    for (const entry of tokenIntro.scheduled) {
      if (entry.landed) continue;
      const ft = tokenIntro.t - entry.startT;
      if (ft < 0) continue;
      // Make visible the moment the fall starts
      if (!entry.shown) { entry.shown = true; entry.tokenMeshes.forEach(m => { m.visible = true; }); }
      const fp = Math.min(1, ft / FALL_DUR);
      const ease = fp * fp; // accelerate downward
      entry.tokenMeshes.forEach((m, i) => {
        m.position.y = 15 + (entry.baseYs[i] - 15) * ease;
      });
      if (fp >= 1) {
        entry.landed = true;
        entry.tokenMeshes.forEach((m, i) => { m.position.y = entry.baseYs[i]; });
        // First landing plays sound effect
        if (!tokenIntro._soundPlayed) {
          tokenIntro._soundPlayed = true;
          const snd = new Audio('sound effects/falling tokens.mp3');
          snd.volume = 0.7;
          snd.play().catch(() => {});
        }
        // Debris particles from impact point
        if (entry.tokenMeshes.length > 0) {
          const m0 = entry.tokenMeshes[0];
          spawnTokenDebris(m0.position.x, entry.baseYs[0], m0.position.z);
        }
        // Tile wiggle on landing
        tokenIntro.landings.push({
          tileMeshes: entry.tileMeshes,
          baseYs: entry.tileMeshes.map(m => m.userData.baseY ?? m.position.y),
          t: 0,
        });
      }
    }
    // Animate tile wiggles
    tokenIntro.landings = tokenIntro.landings.filter(land => {
      land.t += delta;
      const wiggle = Math.sin(land.t * 28) * 0.1 * Math.exp(-land.t * 11);
      land.tileMeshes.forEach((m, i) => { m.position.y = land.baseYs[i] + wiggle; });
      return land.t < 0.6;
    });
    if (tokenIntro.scheduled.length > 0 && tokenIntro.scheduled.every(e => e.landed)) {
      tokenIntro.active = false;
      tokenIntro.done = true;
      // Snap all tile wiggles
      for (const land of tokenIntro.landings) {
        land.tileMeshes.forEach((m, i) => { m.position.y = land.baseYs[i]; });
      }
      tokenIntro.landings = [];
      startRobberDrop();
    }
  }

  // ── Robber drop from sky ──────────────────────────────────────────────────────
  if (robberDropIntro.active && robberAnim.mesh) {
    robberDropIntro.t += delta;
    const fp = Math.min(1, robberDropIntro.t / robberDropIntro.duration);
    const ease = fp * fp;
    robberAnim.mesh.position.y = 15 + (robberDropIntro.targetY - 15) * ease;
    if (fp >= 1) {
      robberDropIntro.active = false;
      robberAnim.mesh.position.y = robberDropIntro.targetY;
      // Play random voice-over then start ports + camera
      const voFile = VO_FILES[Math.floor(Math.random() * VO_FILES.length)];
      const vo = new Audio('voice over/' + encodeURIComponent(voFile));
      vo.volume = 0.85;
      const afterVO = () => {
        boardGroup.userData.portRise = { t: 0, duration: 1.8 };
        cameraIntro.active = true;
        cameraIntro.t = 0;
        setTimeout(() => {
          const whoosh = new Audio('sound effects/' + encodeURIComponent('Unrealsfx - Candy Game Vol 1 - Bubbly Water Whoosh.aac'));
          whoosh.volume = Math.max(sfxVol(), 0.5);
          whoosh.play().catch(e => console.warn('whoosh failed:', e));
        }, 50);
      };
      vo.addEventListener('ended', afterVO, { once: true });
      vo.play().catch(afterVO); // fallback if autoplay blocked
    }
  }
  // ── Debris particles ─────────────────────────────────────────────────────────
  for (let i = debrisParticles.length - 1; i >= 0; i--) {
    const p = debrisParticles[i];
    p.t += delta;
    if (p.t >= p.lifetime) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      debrisParticles.splice(i, 1);
      continue;
    }
    const gravity = 9.8;
    p.mesh.position.x += p.vx * delta;
    p.mesh.position.y += (p.vy - gravity * p.t) * delta;
    p.mesh.position.z += p.vz * delta;
    p.mesh.rotation.x += p.rx * delta;
    p.mesh.rotation.z += p.rz * delta;
    const fade = 1 - p.t / p.lifetime;
    p.mesh.material.opacity = fade;
    p.mesh.material.transparent = true;
  }

  // ── Robber ambient VO loop ────────────────────────────────────────────────────
  if (robberAnim.mesh && tokenIntro.done && !robberDropIntro.active) {
    const dist = camera.position.distanceTo(robberAnim.mesh.position);
    const closeEnough = dist < 12;
    if (closeEnough && !_robberVoEnabled) {
      _robberVoEnabled = true;
      playRobberVoLoop();
    } else if (!closeEnough && _robberVoEnabled) {
      _robberVoEnabled = false;
      if (_robberVoTimer) { clearTimeout(_robberVoTimer); _robberVoTimer = null; }
      _robberVoPlaying = false;
      if (_robberVoAudio) { _robberVoAudio.pause(); _robberVoAudio = null; }
    }
    // Live volume update for the currently playing clip
    if (_robberVoAudio) _robberVoAudio.volume = robberVoVolume();
  }

  if (cameraIntro.active) {
    cameraIntro.t += delta;
    const cp = Math.min(1, cameraIntro.t / cameraIntro.duration);
    const ce = cp * cp * (3 - 2 * cp); // smooth step (ease-in-out)
    camera.position.x = 0;
    const _introEndY = _isMobile ? 22 : 16;
    camera.position.y = 5.5 + ce * (_introEndY - 5.5);
    camera.position.z = 13 + ce * (0.1 - 13);
    camera.lookAt(0, 0, 0);
    if (cp >= 1) {
      cameraIntro.active = false;
      controls.enabled = true;
      camera.position.set(0, _introEndY, 0);
      camera.up.set(0, 1, 0);
      controls.target.set(0, 0, 0);
      controls.update();
      bloom.strength = 0.0;
      const startUpSnd = new Audio('sound effects/Bjorn Lynne - Multimedia - Game Console Start Up.aac');
      startUpSnd.volume = sfxVol();
      startUpSnd.play().catch(() => {});
      socket.emit('introFinished');
    }
  }

  // Tile intro fly-in animation
  if (tileIntro.active) {
    tileIntro.t += delta;
    const rawP = Math.min(1, tileIntro.t / tileIntro.duration);
    // Ease-in-out cubic
    const eP = rawP < 0.5 ? 4*rawP*rawP*rawP : 1 - Math.pow(-2*rawP+2,3)/2;
    // Tiny overshoot spring in final 15%: tiles just barely nudge past target
    let finalP = eP;
    if (rawP > 0.85 && rawP < 1) {
      const sp = (rawP - 0.85) / 0.15;
      finalP = eP + Math.sin(sp * Math.PI * 2.0) * 0.025 * (1 - sp);
    }
    // Y rise: tiles emerge from below water over the first 25% of the anim
    const yRise = rawP < 0.25 ? (rawP / 0.25) - 1 : 0;

    // -- COLLISION RESPONSE: build current XZ for each hex --
    const hexPositions = new Map();
    tileIntro.hexes.forEach(hex => {
      const off = tileIntro.hexOffsets.get(hex.id);
      const coff = tileIntro.hexCollOff.get(hex.id) ?? { x: 0, z: 0 };
      if (!off) return;
      hexPositions.set(hex.id, {
        x: hex.x + off.x0 * (1 - finalP) + coff.x,
        z: hex.z + off.z0 * (1 - finalP) + coff.z,
      });
    });

    // Check all pairs for proximity, apply push impulse
    const TOUCH_DIST = HEX_R * 1.92;
    const hexIds = tileIntro.hexes.map(h => h.id);
    for (let i = 0; i < hexIds.length; i++) {
      for (let j = i + 1; j < hexIds.length; j++) {
        const posA = hexPositions.get(hexIds[i]);
        const posB = hexPositions.get(hexIds[j]);
        if (!posA || !posB) continue;
        const dx = posB.x - posA.x;
        const dz = posB.z - posA.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < TOUCH_DIST * TOUCH_DIST && d2 > 0.001) {
          const d = Math.sqrt(d2);
          const nx = dx / d, nz = dz / d;
          const impulse = (TOUCH_DIST - d) * 0.025;
          const coffA = tileIntro.hexCollOff.get(hexIds[i]);
          const coffB = tileIntro.hexCollOff.get(hexIds[j]);
          if (coffA) { coffA.x -= nx * impulse; coffA.z -= nz * impulse; }
          if (coffB) { coffB.x += nx * impulse; coffB.z += nz * impulse; }
          // Water splash at collision midpoint (throttled)
          if (Math.random() < delta * 30) {
            spawnWaterRing((posA.x + posB.x) * 0.5, (posA.z + posB.z) * 0.5, 0xffffff);
          }
        }
      }
    }

    // Bank island avoidance — push tiles away from the bank island
    const bank = boardGroup.userData.bankIsland;
    if (bank) {
      const bankClearR = bank.r + HEX_R * 1.1;
      hexIds.forEach(hid => {
        const pos = hexPositions.get(hid);
        if (!pos) return;
        const bdx = pos.x - bank.x, bdz = pos.z - bank.z;
        const bd2 = bdx * bdx + bdz * bdz;
        if (bd2 < bankClearR * bankClearR && bd2 > 0.001) {
          const bd = Math.sqrt(bd2);
          const impulse = (bankClearR - bd) * 0.06;
          const coff = tileIntro.hexCollOff.get(hid);
          if (coff) { coff.x += (bdx / bd) * impulse; coff.z += (bdz / bd) * impulse; }
        }
      });
    }

    // Decay collision offsets toward zero
    tileIntro.hexCollOff.forEach(coff => { coff.x *= 0.78; coff.z *= 0.78; });

    // Apply final positions to all board children
    boardGroup.children.forEach(child => {
      const hid = child.userData.hexId ?? child.userData.tokenHexId;
      if (hid === undefined || child.userData.baseX === undefined) return;
      const off = tileIntro.hexOffsets.get(hid);
      if (!off) return;
      const coff = tileIntro.hexCollOff.get(hid) ?? { x: 0, z: 0 };
      child.position.x = child.userData.baseX + off.x0 * (1 - finalP) + coff.x;
      child.position.z = child.userData.baseZ + off.z0 * (1 - finalP) + coff.z;
      child.position.y = child.userData.baseY + yRise * 1.2;
    });

    // Trigger shake at the START of overshoot (when tiles first arrive at target)
    if (!tileIntro.shakeTriggered && rawP >= 0.85) {
      tileIntro.shakeTriggered = true;
      hexIds.forEach(hid => {
        const meshes = boardGroup.children.filter(c => (c.userData.hexId ?? c.userData.tokenHexId) === hid);
        meshes.forEach(m => {
          m.userData._shakeBaseY  = m.position.y;
          m.userData._shakeBaseRX = m.rotation.x;
          m.userData._shakeBaseRZ = m.rotation.z;
          m.userData._shakeNX = (Math.random() - 0.5);
          m.userData._shakeNZ = (Math.random() - 0.5);
        });
        if (meshes.length) hexShakes.push({ meshes, t: 0, duration: 0.45, amp: 0.015, rotAmp: 0.04 });
      });
    }

    // Random ambient splashes while tiles are in motion (white during intro)
    if (rawP < 0.80 && Math.random() < delta * 60) {
      const pos = hexPositions.get(hexIds[Math.floor(Math.random() * hexIds.length)]);
      if (pos) spawnWaterRing(pos.x, pos.z, 0xffffff);
    }

    if (tileIntro.t >= tileIntro.duration) {
      tileIntro.active = false;
      boardGroup.children.forEach(child => {
        if (child.userData.baseX !== undefined) {
          child.position.set(child.userData.baseX, child.userData.baseY, child.userData.baseZ);
        }
      });
      // Begin token fall sequence (ports + robber + camera follow after)
      startTokenIntro();
    }
  }

  // Port + boat rise after intro ends
  const portRise = boardGroup.userData.portRise;
  if (portRise && portRise.t === 0) {
    // Hide port outlines until ports have fully surfaced
    _portOutlinePass.selectedObjects = [];
  }
  if (portRise) {
    portRise.t += delta;
    const rp = Math.min(1, portRise.t / portRise.duration);
    const re = 1 - Math.pow(1 - rp, 3); // ease-out cubic
    const riseOff = (1 - re) * -2.5;
    boardGroup.userData._portRiseOff = riseOff;
    // Fade in over first 1 second
    const fadeP = Math.min(1, portRise.t / 1.0);
    (boardGroup.userData.portGroups ?? []).forEach(pg => {
      pg.traverse(c => { if (c.isMesh && c.material) c.material.opacity = fadeP; });
    });
    (boardGroup.userData.portRoads ?? []).forEach(r => {
      r.position.y = r.userData.portRoadBaseY + riseOff;
      r.material.opacity = fadeP;
    });
    (boardGroup.userData.boats ?? []).forEach(b => {
      b.mesh.traverse(c => { if (c.isMesh && c.material) c.material.opacity = fadeP; });
    });
    // Spawn water splashes as ports/boats emerge
    if (rp < 0.85 && Math.random() < delta * 40) {
      const pgs = boardGroup.userData.portGroups ?? [];
      if (pgs.length) {
        const pg = pgs[Math.floor(Math.random() * pgs.length)];
        spawnWaterRing(pg.position.x, pg.position.z, 0xffffff);
      }
    }
    // Animate vertex markers up and fade in with ports
    if (markerGroup.userData.pendingAppear) {
      markerGroup.children.forEach(m => {
        if (m.userData.markerType === 'vertex') {
          m.position.y = m.userData.baseY + SCENE_PARAMS.vertexMarkerY + riseOff;
        }
        if (m.material) m.material.opacity = fadeP;
      });
    }
    if (rp >= 1) {
      boardGroup.userData._portRiseOff = 0;
      boardGroup.userData.portRise = null;
      // Restore port/boat/dock-road materials to fully opaque
      (boardGroup.userData.portGroups ?? []).forEach(pg => {
        pg.traverse(c => { if (c.isMesh && c.material) { c.material.transparent = false; c.material.opacity = 1; } });
      });
      (boardGroup.userData.portRoads ?? []).forEach(r => {
        r.position.y = r.userData.portRoadBaseY;
        r.material.transparent = false; r.material.opacity = 1;
      });
      (boardGroup.userData.boats ?? []).forEach(b => {
        b.mesh.traverse(c => { if (c.isMesh && c.material) { c.material.transparent = false; c.material.opacity = 1; } });
      });
      // Snap vertex markers fully opaque
      if (markerGroup.userData.pendingAppear) {
        markerGroup.userData.pendingAppear = false;
        markerGroup.children.forEach(m => {
          if (m.material) { m.material.transparent = false; m.material.opacity = 1; }
          if (m.userData.markerType === 'vertex') m.position.y = m.userData.baseY + SCENE_PARAMS.vertexMarkerY;
        });
      }
      // Restore port outlines now that ports are above water
      const _risenPortMeshes = [];
      (boardGroup.userData.portIcons ?? []).forEach(ig => {
        ig.traverse(m => { if (m.isMesh) _risenPortMeshes.push(m); });
      });
      _portOutlinePass.selectedObjects = _risenPortMeshes;
    }
  }

  // Tile bobbing — independent per-hex sine wave (skip during intro sequences)
  if (BOB_PARAMS.enabled && !tileIntro.active && !tokenIntro.active && !robberDropIntro.active) {
    _animSeenHids.clear();
    boardGroup.children.forEach(child => {
      const hid = child.userData.hexId ?? child.userData.tokenHexId;
      if (hid === undefined || child.userData.baseY === undefined) return;
      if (child.userData.isCamel) return;
      if (child.userData.isLava) return;
      const phase = tileBobPhases.get(hid) ?? 0;
      child.position.y = child.userData.baseY + Math.sin(t * BOB_PARAMS.speed + phase) * BOB_PARAMS.amp;
      // Spawn water ring (desktop only — skip on mobile for perf)
      if (!_isMobile && !_animSeenHids.has(hid) && child.userData.hexId !== undefined) {
        _animSeenHids.add(hid);
        const sinVal = Math.sin(t * BOB_PARAMS.speed + phase);
        const spawnRate = delta * 0.55 * WATER_SPRITE_PARAMS.amount * Math.max(0, -sinVal);
        if (Math.random() < spawnRate) {
          spawnWaterRing(child.userData.baseX ?? child.position.x, child.userData.baseZ ?? child.position.z);
        }
      }
    });
  }

  // Hex shake update
  for (let i = hexShakes.length - 1; i >= 0; i--) {
    const hs = hexShakes[i];
    hs.t += delta;
    const p = hs.t / hs.duration;
    if (p >= 1) {
      hs.meshes.forEach(m => {
        m.position.y = m.userData._shakeBaseY;
        m.rotation.x = m.userData._shakeBaseRX;
        m.rotation.z = m.userData._shakeBaseRZ;
      });
      hexShakes.splice(i, 1);
    } else {
      const decay = 1 - p;
      // First half: impact dip (negative), then oscillate
      const wave = Math.sin(p * Math.PI * 9) * decay;
      const yShake = wave * hs.amp;
      const rotShake = wave * hs.rotAmp;
      hs.meshes.forEach(m => {
        const nx = m.userData._shakeNX || 0;
        const nz = m.userData._shakeNZ || 0;
        m.position.y = m.userData._shakeBaseY + yShake;
        m.rotation.x = m.userData._shakeBaseRX - nz * rotShake;
        m.rotation.z = m.userData._shakeBaseRZ + nx * rotShake;
      });
      // Burst of water sprites during the impact wave (first third of shake)
      if (p < 0.35 && Math.random() < delta * 180 * WATER_SPRITE_PARAMS.amount) {
        const m = hs.meshes[0];
        if (m) {
          const ox = (Math.random() - 0.5) * HEX_R * 1.6;
          const oz = (Math.random() - 0.5) * HEX_R * 1.6;
          spawnWaterRing((m.userData.baseX ?? m.position.x) + ox,
                         (m.userData.baseZ ?? m.position.z) + oz);
        }
      }
    }
  }

  // Token wiggle update
  for (let i = tokenWiggles.length - 1; i >= 0; i--) {
    const tw = tokenWiggles[i];
    tw.t += delta;
    const p = tw.t / tw.duration;
    if (p >= 1) {
      tw.mesh.rotation.y = tw.baseRY;
      tokenWiggles.splice(i, 1);
    } else {
      const decay = 1 - p;
      tw.mesh.rotation.y = tw.baseRY + Math.sin(p * SCENE_PARAMS.tokenWiggleSpd) * SCENE_PARAMS.tokenWiggleAmp * decay;
    }
  }

  // Token red pulse update
  for (let i = tokenPulses.length - 1; i >= 0; i--) {
    const tp = tokenPulses[i];
    tp.t += delta;
    const p = tp.t / tp.duration;
    if (p >= 1) {
      tp.mesh.material.emissive.copy(tp.origEmissive);
      tp.mesh.material.emissiveIntensity = tp.origEmissiveIntensity;
      tokenPulses.splice(i, 1);
    } else {
      const decay = 1 - p;
      tp.mesh.material.emissiveIntensity = (0.4 + 0.6 * Math.abs(Math.sin(t * 5))) * decay;
    }
  }

  // Sheep fall-over update: fall (0–0.3s) → lie flat (0.3–2.5s) → get up (2.5–3.5s)
  for (let i = sheepWiggles.length - 1; i >= 0; i--) {
    const sw = sheepWiggles[i];
    sw.t += delta;
    const p = sw.t / sw.duration;
    if (p >= 1) {
      sw.sheep.mesh.position.y = sw.baseY;
      sw.sheep.mesh.rotation.x = sw.baseRX;
      sw.sheep.mesh.rotation.z = sw.baseRZ;
      sheepWiggles.splice(i, 1);
    } else {
      const FALL_END  = 0.3 / sw.duration; // 0 → FALL_END: tip over
      const LIE_END   = 2.5 / sw.duration; // FALL_END → LIE_END: lie flat
      // LIE_END → 1: get up
      let tilt = 0;
      if (p < FALL_END) {
        tilt = (p / FALL_END) * (Math.PI / 2); // tip to 90°
      } else if (p < LIE_END) {
        tilt = Math.PI / 2; // stay flat
      } else {
        tilt = (1 - (p - LIE_END) / (1 - LIE_END)) * (Math.PI / 2); // rise back
      }
      // Apply tilt around the axis perpendicular to fall direction
      sw.sheep.mesh.rotation.x = sw.baseRX + Math.sin(sw.fallAngle) * tilt;
      sw.sheep.mesh.rotation.z = sw.baseRZ - Math.cos(sw.fallAngle) * tilt;
      // Shift body down as it falls
      sw.sheep.mesh.position.y = sw.baseY + Math.sin(tilt) * 0.15;
    }
  }

  // Pulsate my own settlements if I can afford a city upgrade (uses cache)
  if (_canAffordCity) {
    const pulse = 1 + 0.08 * Math.sin(t * 4);
    for (let i = 0; i < _mySettlements.length; i++) {
      const m = _mySettlements[i];
      m.scale.setScalar((m.userData.baseScale ?? 1) * pulse);
    }
  } else if (_mySettlements.length) {
    for (let i = 0; i < _mySettlements.length; i++) {
      const m = _mySettlements[i];
      m.scale.setScalar(m.userData.baseScale ?? 1);
    }
  }

  // Pulsate edge markers if I can afford a road (uses cache)
  if (_canAffordRoad && _edgeMarkerMeshes.length) {
    const pulse = 1 + 0.15 * Math.sin(t * 4 + 0.5);
    for (let i = 0; i < _edgeMarkerMeshes.length; i++) {
      _edgeMarkerMeshes[i].scale.setScalar(pulse);
    }
  }

  // Animated water + sky
  if (boardGroup.userData.oceanMat) {
    const u = boardGroup.userData.oceanMat.uniforms;
    u.uTime.value      = t;
    u.uWaveAmp.value   = WATER_PARAMS.waveAmp;
    u.uWaveSpeed.value = WATER_PARAMS.waveSpeed;
    u.uWaveScale.value = WATER_PARAMS.waveScale;
    u.uFoamStr.value   = WATER_PARAMS.foamStr;
    u.uOpacity.value   = WATER_PARAMS.opacity;
  }
  if (scene.userData.skyMat) {
    const su = scene.userData.skyMat.uniforms;
    su.uTime.value = t;
    su.uHorizon.value.setRGB(SKY_PARAMS.horizonR, SKY_PARAMS.horizonG, SKY_PARAMS.horizonB);
    su.uZenith.value.setRGB(SKY_PARAMS.zenithR, SKY_PARAMS.zenithG, SKY_PARAMS.zenithB);
    su.uHazeAmt.value  = SKY_PARAMS.hazeAmt;
    su.uSunSize.value  = SKY_PARAMS.sunSize;
    su.uSunGlow.value  = SKY_PARAMS.sunGlow;
    // Keep sun direction in sync with time-of-day
    const tod = LIGHT_PARAMS.timeOfDay;
    const ang = tod * Math.PI;
    su.uSunDir.value.set(Math.cos(ang) * 12, Math.max(1, Math.sin(ang) * 22), 6).normalize();
  }
  // Background cloud drift + height + color temperature
  if (scene.userData.cloudGroup) {
    const cg = scene.userData.cloudGroup;
    cg.position.x = Math.sin(t * 0.015) * 1.2;
    cg.position.y = SKY_PARAMS.cloudHeight;
    // Color temperature: only re-set material colors when the value changed
    const ct = SKY_PARAMS.cloudColorTemp;
    if (ct !== scene.userData._lastCloudCT) {
      scene.userData._lastCloudCT = ct;
      const cr = 1.0, cg2 = ct >= 0 ? 1.0 : 1.0 + ct * 0.15, cb = ct >= 0 ? 1.0 - ct * 0.25 : 1.0;
      cg.children.forEach(cloud => {
        cloud.children.forEach(puff => {
          if (puff.material) puff.material.color.setRGB(cr, cg2, cb);
        });
      });
    }
  }

  // Boats — arc routing around the outer water ring, parking spots per dock
  if (boardGroup.userData.boats) {
    const DOCK_WAIT = 60;
    const BOAT_SPEED = Math.max(SCENE_PARAMS.boatSpeed ?? 0.05, 0.001);
    const TRAVEL_R_BASE = 6.2; // each boat gets its own lane to avoid collision
    const boatBaseY = SCENE_PARAMS.boatY;
    const docks = boardGroup.userData.dockPositions;
    const spotPos = boardGroup.userData.spotPos;

    boardGroup.userData.boats.forEach((boat, bi) => {
      const bob = Math.sin(t * 0.9 + bi * 1.7) * 0.0125;
      const riseOff = boardGroup.userData._portRiseOff ?? 0;

      if (boat.targetDockIdx === -1) {
        // ── Docked ─────────────────────────────────────────────────────────
        const dock = docks[boat.dockIdx];
        const sp = spotPos(dock, boat.spotIdx);
        boat.mesh.position.set(sp.x, boatBaseY + bob + riseOff, sp.z);

        if (t - boat.dockArrivalT > DOCK_WAIT) {
          // Find a free spot on a different dock
          const order = Array.from({ length: docks.length }, (_, i) => i)
            .sort(() => Math.random() - 0.5);
          let tdi = -1, tsi = -1;
          for (const di of order) {
            if (di === boat.dockIdx) continue;
            const si = docks[di].spots.indexOf(null);
            if (si !== -1) { tdi = di; tsi = si; break; }
          }
          if (tdi === -1) return; // nowhere to go

          // Claim target spot, release current
          docks[tdi].spots[tsi] = bi;
          docks[boat.dockIdx].spots[boat.spotIdx] = null;

          // Arc travel setup
          const fromAngle = Math.atan2(dock.cz, dock.cx);
          let diff = Math.atan2(docks[tdi].cz, docks[tdi].cx) - fromAngle;
          while (diff > Math.PI) diff -= 2 * Math.PI;
          while (diff < -Math.PI) diff += 2 * Math.PI;
          // Avoid bank island — if shorter arc crosses it, go the long way
          const _bi = boardGroup.userData.bankIsland;
          if (_bi) {
            const bankTheta = Math.atan2(_bi.z, _bi.x);
            const bankDist  = Math.sqrt(_bi.x * _bi.x + _bi.z * _bi.z);
            const bankHalf  = Math.asin(Math.min((_bi.r + 0.6) / bankDist, 0.99));
            // sample arc at fine steps to test for intersection
            const steps = 32;
            let crosses = false;
            for (let s = 0; s <= steps; s++) {
              const a = fromAngle + diff * (s / steps);
              let d = ((a - bankTheta) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
              if (d > Math.PI) d -= Math.PI * 2;
              if (Math.abs(d) < bankHalf) { crosses = true; break; }
            }
            if (crosses) diff = diff > 0 ? diff - Math.PI * 2 : diff + Math.PI * 2;
          }
          boat.fromAngle = fromAngle;
          boat.toAngleDiff = diff;
          boat.travelStart = t;
          const TRAVEL_R_BOAT = TRAVEL_R_BASE + bi * 0.18; // unique lane per boat
          boat.travelR = TRAVEL_R_BOAT;
          boat.travelDuration = Math.max(Math.abs(diff) * TRAVEL_R_BOAT / BOAT_SPEED, 0.5);
          boat.targetDockIdx = tdi;
          boat.targetSpotIdx = tsi;
        }
      } else {
        // ── Traveling along outer water arc ────────────────────────────────
        const TRAVEL_R = boat.travelR ?? (TRAVEL_R_BASE + bi * 0.18);
        const p = Math.min((t - boat.travelStart) / boat.travelDuration, 1);
        const ease = p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p);
        const angle = boat.fromAngle + boat.toAngleDiff * ease;
        boat.mesh.position.set(
          Math.cos(angle) * TRAVEL_R,
          boatBaseY + bob + riseOff,
          Math.sin(angle) * TRAVEL_R
        );
        // Face forward along the arc tangent direction
        const dir = Math.sign(boat.toAngleDiff) || 1;
        const fwdX = -dir * Math.sin(angle);
        const fwdZ =  dir * Math.cos(angle);
        boat.mesh.rotation.y = Math.atan2(fwdX, fwdZ) + (SCENE_PARAMS.boatRotOffset ?? 0);

        if (p >= 1) {
          boat.dockIdx = boat.targetDockIdx;
          boat.spotIdx = boat.targetSpotIdx;
          boat.dockArrivalT = t;
          boat.targetDockIdx = -1;
          boat.targetSpotIdx = -1;
          // Snap to parking spot
          const sp = spotPos(docks[boat.dockIdx], boat.spotIdx);
          boat.mesh.position.set(sp.x, boatBaseY, sp.z);
        }
      }
    });
  }

  // Port icons — billboard toward camera + gentle float
  if (boardGroup.userData.portIcons) {
    boardGroup.userData.portIcons.forEach((ig, i) => {
      ig.getWorldPosition(_animWorldPos);
      _animToCam.copy(camera.position).sub(_animWorldPos);
      _animToCam.y = 0;
      if (_animToCam.lengthSq() > 0.0001) {
        ig.rotation.y = Math.atan2(_animToCam.x, _animToCam.z);
      }
      if (!_isMobile) ig.position.y = SCENE_PARAMS.portIconY + Math.sin(t * 1.1 + i * 1.3) * 0.05;
    });
  }

  // Marker glow pulsation — skip on mobile
  if (!_isMobile && markerGroup.children.length && !markerGroup.userData.pendingAppear) {
    const glowOpacity = 0.30 + Math.sin(t * 2.8) * 0.20;
    markerGroup.children.forEach(marker => {
      marker.children.forEach(child => {
        if (child.userData.markerGlow && child.material) child.material.opacity = glowOpacity;
      });
    });
  }

  // ── Lava pulse + steam ───────────────────────────────────────────────────────
  if (!_isMobile && boardGroup.userData.lavaMeshes) {
    boardGroup.userData.lavaMeshes.forEach(m => {
      const phase = m.userData.lavaPhase ?? 0;
      const pulse = Math.sin(t * 3.1 + phase);
      const intensity = 1.4 + 0.7 * pulse;
      m.material.emissiveIntensity = intensity;
      const g = 0.18 + 0.18 * Math.max(0, pulse);
      m.material.color.setRGB(1.0, g, 0);
      m.material.emissive.setRGB(0.9, g * 0.4, 0);
      if (BOB_PARAMS.enabled && !tileIntro.active && m.userData.hexId !== undefined && m.userData._lavaBaseY !== undefined) {
        const bobPhase = tileBobPhases.get(m.userData.hexId) ?? 0;
        m.position.y = m.userData._lavaBaseY + Math.sin(t * BOB_PARAMS.speed + bobPhase) * BOB_PARAMS.amp;
      }
    });

    // ── Eruption timer ────────────────────────────────────────────────────────
    if (_lavaEruption.activeTileId !== null) {
      _lavaEruption.elapsed += delta;
      if (_lavaEruption.elapsed >= _lavaEruption.duration) {
        _stopLavaEruption();
      }
    } else if (gameState?.board?.hexes) {
      _lavaEruption.nextIn -= delta;
      if (_lavaEruption.nextIn <= 0) {
        _startLavaEruption(gameState.board.hexes);
      }
    }

    // Steam spawning from lava-meets-edge origins
    const origins = boardGroup.userData.lavaSteamOrigins ?? [];
    if (origins.length && LAVA_PARAMS.steamAmount > 0) {
      for (const o of origins) {
        if (Math.random() < LAVA_PARAMS.steamAmount * delta) {
          const spriteMat = new THREE.SpriteMaterial({
            map: _steamCircleTex,
            color: 0xffffff,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          });
          const sprite = new THREE.Sprite(spriteMat);
          const spread = 0.15;
          sprite.position.set(
            o.x + (Math.random() - 0.5) * spread,
            o.y,
            o.z + (Math.random() - 0.5) * spread
          );
          sprite.scale.setScalar((0.18 + Math.random() * 0.14) * LAVA_PARAMS.steamSize);
          scene.add(sprite);
          LAVA_STEAM.push({
            sprite,
            vy: 0.3 + Math.random() * 0.25,
            vx: (Math.random() - 0.5) * 0.04,
            vz: (Math.random() - 0.5) * 0.04,
            t: 0,
            life: 1.8 + Math.random() * 1.4,
          });
        }
      }
    }
  }

  // Steam particle update
  for (let i = LAVA_STEAM.length - 1; i >= 0; i--) {
    const p = LAVA_STEAM[i];
    p.t += delta;
    if (p.t >= p.life) {
      scene.remove(p.sprite);
      p.sprite.material.dispose();
      LAVA_STEAM.splice(i, 1);
      continue;
    }
    const prog = p.t / p.life;
    // Rise with configurable upward gravity
    p.vy += LAVA_PARAMS.steamGravity * delta; // negative gravity → accelerates up
    p.sprite.position.x += p.vx * delta;
    p.sprite.position.y -= p.vy * delta;      // subtract because gravity is negative (up)
    p.sprite.position.z += p.vz * delta;
    // Expand + fade: appear quickly, hold, then fade out
    const fadeIn  = Math.min(1, prog / 0.15);
    const fadeOut = Math.max(0, 1 - (prog - 0.6) / 0.4);
    p.sprite.material.opacity = LAVA_PARAMS.steamOpacity * fadeIn * fadeOut;
    p.sprite.scale.setScalar((0.18 + prog * 0.35));
    p.sprite.material.needsUpdate = true;
  }

  if (boardGroup.userData.mountainClouds) {
    boardGroup.userData.mountainClouds.forEach(cg => {
      const s = cg.userData.cloudSeed ?? 0;
      // Find the tile's current Y offset via the hex cylinder child
      let tileYOff = 0;
      if (BOB_PARAMS.enabled && !tileIntro.active && cg.userData.hexId !== undefined) {
        const phase = tileBobPhases.get(cg.userData.hexId) ?? 0;
        tileYOff = Math.sin(t * BOB_PARAMS.speed + phase) * BOB_PARAMS.amp;
      }
      cg.position.y = cg.userData.cloudBase + tileYOff + Math.sin(t * 0.4 * CLOUD_PARAMS.speed + s) * 0.06;
      cg.position.x += Math.sin(t * 0.12 * CLOUD_PARAMS.speed + s * 0.7) * 0.0008;
      cg.children.forEach(m => {
        if (m.material) {
          m.material.opacity = CLOUD_PARAMS.opacity;
          m.material.emissiveIntensity = CLOUD_PARAMS.brightness;
        }
      });
    });
  }

  // ── Robber animation ──
  if (robberAnim.mesh) {
    // Helper: crossfade to a named clip
    const playClip = (name) => {
      const next = robberAnim.actions[name];
      if (!next || next === robberAnim.currentAction) return;
      if (robberAnim.currentAction) robberAnim.currentAction.fadeOut(0.4);
      next.reset().fadeIn(0.4).play();
      robberAnim.currentAction = next;
      console.log(`[Robber] → ${name}`);
    };

    const available = Object.keys(robberAnim.actions);
    const idleClips   = available.filter(n => !MOVING_CLIPS.includes(n));
    const movingAvail = MOVING_CLIPS.filter(n => robberAnim.actions[n]);

    // On state change (idle ↔ active)
    if (robberAnim.active !== robberAnim.lastActive) {
      robberAnim.lastActive = robberAnim.active;
      robberAnim.cycleTimer = 0;

      if (robberAnim.mixer && available.length) {
        if (robberAnim.active) {
          const pick = movingAvail.length ? movingAvail[Math.floor(Math.random() * movingAvail.length)] : available[0];
          playClip(pick);
        } else {
          const pick = idleClips.length ? idleClips[0] : available[0];
          playClip(pick);
        }
      }
    }

    // Idle cycling disabled — robber stays still until clicked

    // When active, cycle moving animations too
    if (robberAnim.active && robberAnim.mixer && movingAvail.length > 1) {
      robberAnim.cycleTimer += delta;
      if (robberAnim.cycleTimer >= robberAnim.cycleInterval) {
        robberAnim.cycleTimer = 0;
        robberAnim.cycleInterval = ROBBER_PARAMS.animCycle * 0.4 + Math.random() * ROBBER_PARAMS.animCycle * 0.3;
        const next = movingAvail[Math.floor(Math.random() * movingAvail.length)];
        playClip(next);
      }
    }

    // Advance mixer (sync timeScale live)
    if (robberAnim.mixer) {
      robberAnim.mixer.timeScale = ROBBER_PARAMS.animSpeed;
      robberAnim.mixer.update(delta);
    }

    // Procedural fallback bob + spin (only when no GLB mixer)
    if (!robberAnim.mixer) {
      const speed    = robberAnim.active ? 3.5 : 1.2;
      const bobAmp   = robberAnim.active ? 0.12 : 0.05;
      const spinSpd  = robberAnim.active ? 1.8 : 0.4;
      robberAnim.mesh.position.y = robberAnim.baseY + Math.sin(t * speed) * bobAmp;
      robberAnim.mesh.rotation.y += delta * spinSpd;
    }

    // Emissive red pulse when active
    robberAnim.mesh.traverse(c => {
      if (!c.isMesh) return;
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach(mat => {
        if (!mat) return;
        if (!mat._robberEmissiveSet) {
          mat.emissive = new THREE.Color(0xff2200);
          mat._robberEmissiveSet = true;
        }
        mat.emissiveIntensity = robberAnim.active
          ? 0.25 + 0.25 * Math.sin(t * 6)
          : 0.0;
      });
    });
  }

  // ── Robber arc movement ──
  if (robberMove.active && robberAnim.mesh) {
    robberMove.t += delta;
    const p = Math.min(1, robberMove.t / robberMove.duration);
    const ease = 0.5 - Math.cos(p * Math.PI) / 2; // smooth in-out
    const arcH  = Math.sin(p * Math.PI) * 1.4;    // parabolic arc
    const x = robberMove.startX + (robberMove.endX - robberMove.startX) * ease;
    const z = robberMove.startZ + (robberMove.endZ - robberMove.startZ) * ease;
    const y = robberAnim.baseY + (robberMove.endY - robberAnim.baseY) * ease + arcH;
    robberAnim.mesh.position.set(x, y, z);
    // Face direction of travel
    const dx = robberMove.endX - robberMove.startX, dz = robberMove.endZ - robberMove.startZ;
    if (Math.abs(dx) + Math.abs(dz) > 0.01) robberAnim.mesh.rotation.y = Math.atan2(dx, dz);
    if (p >= 1) {
      robberMove.active = false;
      robberAnim.active = false;
      robberAnim.lastActive = null; // force switch back to idle
      robberAnim.baseY = robberMove.endY;
      // Final snap
      robberAnim.mesh.position.set(robberMove.endX, robberMove.endY, robberMove.endZ);
      // Play the voice-over now that the robber has landed
      if (robberMove.pendingVO) {
        const rvo = new Audio('voice over/' + robberMove.pendingVO);
        rvo.volume = voVol();
        rvo.play().catch(() => {});
        robberMove.pendingVO = null;
      }
    }
  }

  updateDiceAnim(delta);
  updateVoicePlayers();
  _lobbyUpdateVoiceRings();

  composer.render();
  if (_is2D) _draw2DBoard();
  _updateFPS();
}
// ─── 2D Mode: top-down camera + robber overlay ────────────────────────────────

const _robberImg2D = new Image();
_robberImg2D.src = 'images/Robber.png';

const _overlay2d    = document.getElementById('overlay2d');
const _overlayCtx   = _overlay2d.getContext('2d');

function _resizeOverlay() {
  _overlay2d.width  = renderer.domElement.clientWidth  || window.innerWidth;
  _overlay2d.height = renderer.domElement.clientHeight || window.innerHeight;
}

const _2D_TILE_COLORS = {
  forest:'#2d6e2a', pasture:'#78b84a', fields:'#d4a017',
  hills:'#b5451b', mountains:'#78909c', desert:'#c9b98a', water:'#1a6fa8'
};
const _2D_TILE_BORDER = {
  forest:'#1a4a18', pasture:'#4a8a20', fields:'#9a7010',
  hills:'#7a2a0a', mountains:'#4a6070', desert:'#9a8a60', water:'#0a4a78'
};
const _2D_PORT_COLORS = {
  wood:'#6b9b37', sheep:'#a8d570', wheat:'#f5c842', brick:'#c0522a', ore:'#8899aa', any:'#e8dcc8'
};
const _2D_PORT_ICONS = { wood:'🪵', sheep:'🐑', wheat:'🌾', brick:'🧱', ore:'🪨' };
const _2D_NUMBER_HOT = new Set([6,8]);

// Pre-built 64×64 pattern source canvases (created once, scaled per zoom via ctx.scale)
const _2D_PAT_SRC = (() => {
  const S = 64;
  function make(type) {
    const pc = document.createElement('canvas'); pc.width = S; pc.height = S;
    const px = pc.getContext('2d');
    const base = _2D_TILE_COLORS[type] || '#888';
    px.fillStyle = base; px.fillRect(0,0,S,S);
    if (type === 'forest') {
      const positions = [[14,16],[42,36],[28,8],[8,44],[50,50],[36,56],[20,30],[54,18]];
      positions.forEach(([x,y]) => {
        px.fillStyle='rgba(0,80,0,0.30)'; px.beginPath(); px.arc(x,y,9,0,Math.PI*2); px.fill();
        px.fillStyle='rgba(0,50,0,0.20)'; px.beginPath(); px.arc(x,y,5,0,Math.PI*2); px.fill();
      });
    } else if (type === 'pasture') {
      px.strokeStyle='rgba(120,200,50,0.45)'; px.lineWidth=2;
      [[10,52],[22,42],[36,56],[50,42],[60,54],[6,28],[18,20],[34,30],[48,22],[60,30]].forEach(([x,y])=>{
        px.beginPath(); px.moveTo(x,y); px.lineTo(x+3,y-12); px.lineTo(x+6,y); px.stroke();
      });
    } else if (type === 'fields') {
      px.strokeStyle='rgba(140,90,0,0.28)'; px.lineWidth=1.5;
      for(let y=5;y<S;y+=10){ px.beginPath(); px.moveTo(0,y); px.lineTo(S,y); px.stroke(); }
      px.strokeStyle='rgba(180,130,20,0.18)'; px.lineWidth=1;
      for(let x=8;x<S;x+=16){ px.beginPath(); px.moveTo(x,0); px.lineTo(x,S); px.stroke(); }
    } else if (type === 'hills') {
      px.fillStyle='rgba(0,0,0,0.14)';
      [[0,0,32,11],[32,11,32,11],[0,22,32,11],[32,33,32,11],[0,44,32,11],[32,55,32,11]].forEach(([x,y,w,h])=>{
        px.fillRect(x+1,y+1,w-2,h-2);
      });
      px.strokeStyle='rgba(80,20,0,0.20)'; px.lineWidth=1;
      for(let r=0;r<S;r+=11){
        const off=r%22===0?0:32;
        px.beginPath(); px.moveTo(0,r); px.lineTo(S,r); px.stroke();
        px.beginPath(); px.moveTo(off,r); px.lineTo(off,r+11); px.stroke();
        px.beginPath(); px.moveTo(off+32,r); px.lineTo(off+32,r+11); px.stroke();
      }
    } else if (type === 'mountains') {
      px.strokeStyle='rgba(40,60,80,0.30)'; px.lineWidth=2;
      [[4,58,20,26],[20,26,36,48],[36,48,52,20],[52,20,62,40],[8,44,26,54]].forEach(([x1,y1,x2,y2])=>{
        px.beginPath(); px.moveTo(x1,y1); px.lineTo(x2,y2); px.stroke();
      });
    } else if (type === 'desert') {
      px.strokeStyle='rgba(150,110,40,0.22)'; px.lineWidth=1.5;
      for(let y=8;y<S;y+=14){
        px.beginPath();
        for(let x=0;x<=S;x+=4) { const yy=y+Math.sin(x*0.25)*3; x===0?px.moveTo(x,yy):px.lineTo(x,yy); }
        px.stroke();
      }
    }
    return pc;
  }
  const types = ['forest','pasture','fields','hills','mountains','desert'];
  const out = {};
  types.forEach(t => { out[t] = make(t); });
  return out;
})();

function _w2c(wx, wz) {
  const v = new THREE.Vector3(wx, 0, wz).project(camera);
  return [(v.x*0.5+0.5)*_overlay2d.width, (v.y*-0.5+0.5)*_overlay2d.height];
}

function _hexPts(hex) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI/3)*i;
    pts.push(_w2c(hex.x + Math.cos(a)*HEX_R, hex.z + Math.sin(a)*HEX_R));
  }
  return pts;
}

let _2dLastDraw = 0;
function _draw2DBoard() {
  const now = performance.now();
  if (now - _2dLastDraw < 33) return; // cap at ~30fps
  _2dLastDraw = now;
  _overlayCtx.clearRect(0, 0, _overlay2d.width, _overlay2d.height);
  if (!_is2D || !gameState?.board) return;
  // (no early return for diceAnim — tiles stay visible; dice hole punched below)
  const W = _overlay2d.width, H = _overlay2d.height;
  const ctx = _overlayCtx;

  // Hex pixel radius — recomputed each frame so it tracks zoom
  const anyHex = gameState.board.hexes.find(h=>h.type!=='water');
  let hexPxR = H * 0.06;
  if (anyHex) {
    const [cx] = _w2c(anyHex.x, anyHex.z);
    const [ex] = _w2c(anyHex.x + HEX_R, anyHex.z);
    hexPxR = Math.abs(ex - cx);
  }

  // Helper: draw the hex path (does NOT call beginPath)
  function hexPath(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i=1;i<6;i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }

  // Draw water/port hexes first, then land hexes on top
  const sorted = [...gameState.board.hexes].sort((a,b) => (a.type==='water'?-1:1));

  ctx.globalAlpha = 0.50;
  sorted.forEach(hex => {
    const pts = _hexPts(hex);

    // Flat color fill — no texture
    hexPath(pts);
    ctx.fillStyle = _2D_TILE_COLORS[hex.type] || '#888';
    ctx.fill();

    if (hex.type !== 'water') {
      // Subtle bevel for slight depth
      ctx.save();
      hexPath(pts); ctx.clip();
      const bw = hexPxR * 0.18;
      ctx.lineWidth = bw;
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.moveTo(pts[5][0],pts[5][1]); ctx.lineTo(pts[0][0],pts[0][1]);
      ctx.lineTo(pts[1][0],pts[1][1]); ctx.lineTo(pts[2][0],pts[2][1]);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.moveTo(pts[2][0],pts[2][1]); ctx.lineTo(pts[3][0],pts[3][1]);
      ctx.lineTo(pts[4][0],pts[4][1]); ctx.lineTo(pts[5][0],pts[5][1]);
      ctx.stroke();
      ctx.restore();
    }

    // Border
    hexPath(pts);
    ctx.strokeStyle = _2D_TILE_BORDER[hex.type] || '#555';
    ctx.lineWidth = Math.max(1, hexPxR * 0.06);
    ctx.stroke();
  });
  ctx.globalAlpha = 1.0;

  // Number tokens
  gameState.board.hexes.forEach(hex => {
    if (!hex.number) return;
    const [cx,cy] = _w2c(hex.x, hex.z);
    const hot = _2D_NUMBER_HOT.has(hex.number);
    const r = hexPxR * 0.30;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.fillStyle = hot ? '#c0392b' : '#f5e6c8'; ctx.fill();
    ctx.strokeStyle = '#7a5a30'; ctx.lineWidth = Math.max(1, r*0.1); ctx.stroke();
    ctx.fillStyle = hot ? '#fff' : '#2c1a00';
    ctx.font = `bold ${Math.round(r*1.1)}px sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(hex.number, cx, cy);
  });

  // Colonist-style ports
  if (gameState.board.ports) {
    const bCx = W/2, bCy = H/2; // canvas center (approximates board center)
    gameState.board.ports.forEach(port => {
      const v1 = gameState.board.vertices[port.vertices[0]];
      const v2 = gameState.board.vertices[port.vertices[1]];
      if (!v1||!v2) return;
      const [x1,y1] = _w2c(v1.x, v1.z);
      const [x2,y2] = _w2c(v2.x, v2.z);
      const mx=(x1+x2)/2, my=(y1+y2)/2;
      // Outward from board center
      const od = Math.hypot(mx-bCx, my-bCy)||1;
      const nx=(mx-bCx)/od, ny=(my-bCy)/od;
      const pier = hexPxR*0.7;
      const dx = mx+nx*pier, dy = my+ny*pier; // dock badge center

      // Pier lines to each vertex
      ctx.strokeStyle = '#6b4c1a'; ctx.lineWidth = Math.max(2, hexPxR*0.06); ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(dx,dy); ctx.lineTo(x1,y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(dx,dy); ctx.lineTo(x2,y2); ctx.stroke();

      // Vertex dots (shows which spots have port access)
      [x1,y1,x2,y2].forEach((_, i, a) => {
        if (i%2!==0) return;
        const [vx,vy]=[a[i],a[i+1]];
        ctx.beginPath(); ctx.arc(vx,vy, hexPxR*0.09,0,Math.PI*2);
        ctx.fillStyle='#6b4c1a'; ctx.fill();
      });

      // Badge background (no stroke on outer circle)
      const br = hexPxR*0.32;
      ctx.beginPath(); ctx.arc(dx,dy,br,0,Math.PI*2);
      ctx.fillStyle='#2a1a00'; ctx.fill();

      // Badge inner color
      ctx.beginPath(); ctx.arc(dx,dy,br*0.80,0,Math.PI*2);
      ctx.fillStyle=_2D_PORT_COLORS[port.type]||'#ddd'; ctx.fill();

      // Ratio text + icon
      const ratio = port.type==='any'?'3:1':'2:1';
      ctx.save();
      // 3:1 (any port) gets black text on light bg; 2:1 resource ports get white with shadow
      const isAny = port.type === 'any';
      ctx.fillStyle = isAny ? '#000' : '#fff';
      ctx.shadowColor = isAny ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.95)';
      ctx.shadowBlur = Math.max(3, br * 0.22);
      ctx.textAlign='center'; ctx.textBaseline='middle';
      if (isAny) {
        ctx.font=`bold ${Math.round(br*0.72)}px sans-serif`;
        ctx.fillText(ratio, dx, dy);
      } else {
        ctx.font=`bold ${Math.round(br*0.72)}px sans-serif`;
        ctx.fillText(ratio, dx, dy - br*0.18);
        const icon = _2D_PORT_ICONS[port.type]||'';
        ctx.font=`${Math.round(br*0.52)}px sans-serif`;
        ctx.fillText(icon, dx, dy + br*0.46);
      }
      ctx.restore();
    });
  }

  // Player color lookup
  const _pidColor = {};
  (gameState.players || []).forEach(p => { _pidColor[p.id] = p.color || '#e74c3c'; });

  // Roads
  if (gameState.board.edges) {
    gameState.board.edges.forEach(e => {
      if (!e.road) return;
      const v1 = gameState.board.vertices[e.vertices[0]];
      const v2 = gameState.board.vertices[e.vertices[1]];
      if (!v1||!v2) return;
      const [x1,y1] = _w2c(v1.x, v1.z);
      const [x2,y2] = _w2c(v2.x, v2.z);
      const col = _pidColor[e.road.playerId] || '#e74c3c';
      const lw = Math.max(2, hexPxR*0.13);
      // Outline
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
      ctx.strokeStyle='rgba(0,0,0,0.55)'; ctx.lineWidth=lw+Math.max(2,hexPxR*0.07);
      ctx.lineCap='round'; ctx.stroke();
      // Fill
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
      ctx.strokeStyle=col; ctx.lineWidth=lw; ctx.stroke();
    });
  }

  // Simplified 2D building shapes
  if (gameState.board.vertices) {
    gameState.board.vertices.forEach(v => {
      if (!v.building) return;
      const [px, py] = _w2c(v.x, v.z);
      const col = _pidColor[v.building.playerId] || '#e74c3c';
      const isCity = v.building.type === 'city';
      const s = hexPxR * (isCity ? 0.30 : 0.22);

      ctx.save();
      // Drop shadow
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = s * 0.6;
      ctx.shadowOffsetY = s * 0.2;

      if (isCity) {
        // City: larger filled square with notch (castle silhouette)
        ctx.fillStyle = col;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(1.5, s * 0.18);
        // Main body
        ctx.beginPath();
        ctx.rect(px - s, py - s * 0.7, s * 2, s * 1.4);
        ctx.fill(); ctx.stroke();
        // Two battlements on top
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.rect(px - s, py - s * 1.2, s * 0.7, s * 0.55); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.rect(px + s * 0.3, py - s * 1.2, s * 0.7, s * 0.55); ctx.fill(); ctx.stroke();
      } else {
        // Settlement: pentagon (house shape)
        ctx.fillStyle = col;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(1.5, s * 0.18);
        ctx.beginPath();
        ctx.moveTo(px,       py - s * 1.1);  // roof peak
        ctx.lineTo(px + s,   py - s * 0.2);  // roof right
        ctx.lineTo(px + s,   py + s * 0.8);  // base right
        ctx.lineTo(px - s,   py + s * 0.8);  // base left
        ctx.lineTo(px - s,   py - s * 0.2);  // roof left
        ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    });
  }

  // Hex markers — red robber-placement overlays
  if (typeof markerGroup !== 'undefined') {
    markerGroup.children.forEach(m => {
      if (!m.visible) return;
      if (m.userData.type !== 'hexMarker') return;
      const h = gameState.board.hexes[m.userData.hexId];
      if (!h) return;
      const pts = _hexPts(h);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i=1;i<6;i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,40,0,0.30)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,80,0,0.70)';
      ctx.lineWidth = Math.max(2, hexPxR * 0.08);
      ctx.stroke();
    });
  }

  // Vertex/edge markers (drawn on canvas so they're above the 2D tiles)
  if (typeof markerGroup !== 'undefined') {
    markerGroup.children.forEach(m => {
      if (!m.visible) return;
      if (m.userData.vertexId !== undefined) {
        const v = gameState.board.vertices[m.userData.vertexId];
        if (!v) return;
        const [px,py] = _w2c(v.x, v.z);
        const r = hexPxR * 0.2;
        ctx.beginPath(); ctx.arc(px,py,r,0,Math.PI*2);
        ctx.fillStyle = 'rgba(255,215,0,0.92)'; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.5,r*0.2); ctx.stroke();
      } else if (m.userData.edgeId !== undefined) {
        const e = gameState.board.edges[m.userData.edgeId];
        if (!e) return;
        const v1 = gameState.board.vertices[e.vertices[0]];
        const v2 = gameState.board.vertices[e.vertices[1]];
        if (!v1||!v2) return;
        const [x1,y1] = _w2c(v1.x, v1.z);
        const [x2,y2] = _w2c(v2.x, v2.z);
        const r = hexPxR * 0.16;
        ctx.beginPath(); ctx.arc((x1+x2)/2,(y1+y2)/2,r,0,Math.PI*2);
        ctx.fillStyle = 'rgba(255,215,0,0.92)'; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.5,r*0.2); ctx.stroke();
      }
    });
  }

  // Robber
  const rHex = gameState.board.hexes[gameState.robberHex];
  if (rHex) {
    const [px,py] = _w2c(rHex.x, rHex.z);
    const size = hexPxR * 1.3;
    if (_robberImg2D.complete && _robberImg2D.naturalWidth > 0) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(_robberImg2D, px - size/2, py - size*0.85, size, size*1.2);
      ctx.restore();
    } else {
      ctx.fillStyle = '#1a1a1a'; ctx.beginPath();
      ctx.arc(px, py-size*0.15, size*0.4, 0, Math.PI*2); ctx.fill();
    }
  }

  // Punch a transparent hole where the 3D dice are so they show through the canvas
  if (typeof diceAnim !== 'undefined' && diceGroup.visible) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    [die1, die2].forEach(die => {
      const sp = die.position.clone().project(camera);
      const sx = ( sp.x * 0.5 + 0.5) * W;
      const sy = (-sp.y * 0.5 + 0.5) * H;
      const r = hexPxR * 1.2;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,1)'; ctx.fill();
    });
    ctx.restore();
  }
}

// Objects to hide when entering 2D mode
function _set2DVisibility(visible) {
  // Keep 3D tiles visible in 2D (canvas overlay sits on top at 80% opacity)
  // Only de-reflectivize tokens in 2D, restore in 3D
  boardGroup.children.forEach(child => {
    // De-reflectivize tokens in 2D, restore in 3D
    if (child.userData.tokenHexId !== undefined) {
      child.traverse(m => {
        if (m.material) {
          if (!visible) {
            // entering 2D: store original values, flatten material
            if (m.material.envMapIntensity !== undefined) {
              m.userData._origEnv = m.material.envMapIntensity;
              m.userData._origMet = m.material.metalness;
              m.userData._origEmi = m.material.emissiveIntensity;
              m.material.envMapIntensity = 0;
              m.material.metalness = 0.05;
              m.material.emissiveIntensity = 0;
              m.material.needsUpdate = true;
            }
          } else {
            // exiting 2D: restore
            if (m.userData._origEnv !== undefined) {
              m.material.envMapIntensity = m.userData._origEnv;
              m.material.metalness = m.userData._origMet;
              m.material.emissiveIntensity = m.userData._origEmi;
              m.material.needsUpdate = true;
            }
          }
        }
      });
    }
  });
  // Hide lava meshes
  (boardGroup.userData.lavaMeshes || []).forEach(m => { m.visible = visible; });
  // Hide clouds
  const clouds = scene.userData.cloudGroup;
  if (clouds) clouds.visible = visible;
  // Hide 3D robber (replaced by robber.png overlay in 2D)
  robberGroup.visible = visible;
  // Hide 3D port groups in 2D (drawn as colonist-style 2D instead)
  (boardGroup.userData.portGroups ?? []).forEach(pg => { pg.visible = visible; });
  (boardGroup.userData.portRoads  ?? []).forEach(r  => { r.visible  = visible; });
}

// ── 2D / 3D toggle ────────────────────────────────────────────────────────────
var _is2D = false;
const _btn2d = document.getElementById('btn2dToggle');

let _3dCamPos    = null;
let _3dCamTarget = null;
let _3dMaxPolar  = controls.maxPolarAngle;
let _3dMinDist   = controls.minDistance;
let _3dMaxDist   = controls.maxDistance;

function toggle2D() {
  _is2D = !_is2D;

  if (_is2D) {
    _3dCamPos    = camera.position.clone();
    _3dCamTarget = controls.target.clone();

    // Derive 2D height from current 3D distance so zoom level stays consistent
    // On mobile use a fixed height that fills the screen nicely
    const dist3d = _3dCamPos.distanceTo(_3dCamTarget);
    const height2d = _isMobile ? 13.5 : Math.max(8, Math.min(35, dist3d * 0.72));

    camera.up.set(0, 0, -1);
    controls.enableRotate = false;
    controls.maxPolarAngle = 0.001;
    controls.minDistance = 5;
    controls.maxDistance = 35;
    camera.position.set(controls.target.x, height2d, controls.target.z);
    controls.target.set(controls.target.x, 0, controls.target.z);
    controls.update();

    _set2DVisibility(false);
    _outlinePasses.forEach(o => { o.pass.enabled = false; });
    _portOutlinePass.enabled = false;
    _resizeOverlay();
    _overlay2d.style.display = 'block';

    _btn2d.textContent = '3D';
    _btn2d.classList.add('active');
  } else {
    camera.up.set(0, 1, 0);
    controls.enableRotate = true;
    controls.maxPolarAngle = _3dMaxPolar;
    controls.minDistance   = _3dMinDist;
    controls.maxDistance   = _3dMaxDist;

    // Restore 3D angle/zoom but applied to wherever the user panned in 2D
    if (_3dCamPos && _3dCamTarget) {
      const offset = _3dCamPos.clone().sub(_3dCamTarget);
      camera.position.copy(controls.target).add(offset);
    }
    controls.update();

    _set2DVisibility(true);
    _outlinePasses.forEach(o => { o.pass.enabled = true; });
    _portOutlinePass.enabled = true;
    _overlayCtx.clearRect(0, 0, _overlay2d.width, _overlay2d.height);
    _overlay2d.style.display = 'none';

    _btn2d.textContent = '2D';
    _btn2d.classList.remove('active');
  }
}

_btn2d.addEventListener('click', toggle2D);
window.addEventListener('resize', () => { if (_is2D) _resizeOverlay(); });

animate();
