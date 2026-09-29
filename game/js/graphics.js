// Realistic rendering: physically based sky + image-based lighting from it,
// ambient occlusion, bloom, filmic grading, vignette and film grain.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';

// Draws a second scene (the first-person hands and gun) over the frame with a
// cleared depth buffer, so the weapon never clips into walls and can use its own FOV.
class OverlayPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene; this.camera = camera;
    this.needsSwap = false;
  }
  render(renderer, writeBuffer, readBuffer) {
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
  }
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.42 },
    uGrain: { value: 0.035 },
    uSat: { value: 1.06 },
    uContrast: { value: 1.06 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uHurt: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uSat, uContrast, uHurt; uniform vec3 uTint;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat * (1.0 - uHurt * 0.8));
      c.rgb = (c.rgb - 0.5) * uContrast + 0.5;
      c.rgb *= uTint;
      float d = length(vUv - 0.5);
      c.rgb *= mix(1.0, smoothstep(0.85, 0.25, d), uVignette + uHurt * 0.4);
      c.rgb = mix(c.rgb, vec3(0.45, 0.0, 0.0), uHurt * smoothstep(0.3, 0.75, d) * 0.6);
      c.rgb += (hash(vUv * 731.0) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
    }`,
};

// the Preetham model is calibrated for a much lower exposure than the rest of the scene
function tameSky(sky, gain) {
  const m = sky.material;
  m.uniforms.uGain = { value: gain };
  m.fragmentShader = m.fragmentShader
    .replace('uniform vec3 up;', 'uniform vec3 up;\nuniform float uGain;')
    .replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * uGain, 1.0 );');
  m.needsUpdate = true;
}

export class Graphics {
  constructor(renderer, scene, camera, quality, overlay) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.high = quality === 'high';
    const w = window.innerWidth, h = window.innerHeight;

    // --- sky (Preetham) that follows the camera
    this.sky = new Sky();
    this.sky.scale.setScalar(2500);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -2;
    tameSky(this.sky, 0.5);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    scene.add(this.sky);
    // separate sky used to bake the environment map
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(100);
    tameSky(this.envSky, 0.5);
    this.envScene.add(this.envSky);
    this.envGround = new THREE.Mesh(new THREE.CircleGeometry(90, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3c3b36 }));
    this.envGround.position.y = -2;
    this.envScene.add(this.envGround);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.lastEnvKey = '';

    // stars for the night
    const n = 1800, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection();
      v.y = Math.abs(v.y) * 0.95 + 0.05;
      v.normalize().multiplyScalar(2300);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // --- post-processing
    const rt = new THREE.WebGLRenderTarget(w * renderer.getPixelRatio(), h * renderer.getPixelRatio(), {
      type: THREE.HalfFloatType,
      samples: this.high ? 4 : 0,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    if (this.high) {
      this.gtao = new GTAOPass(scene, camera, w, h);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.9;
      this.gtao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.5, thickness: 2.5, scale: 1.2, samples: 12, distanceFallOff: 1 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.composer.addPass(this.gtao);
    }
    if (overlay) this.composer.addPass(new OverlayPass(overlay.scene, overlay.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.4, 0.95);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  setSun(dir, night, rain) {
    const u = this.sky.material.uniforms, eu = this.envSky.material.uniforms;
    for (const uu of [u, eu]) {
      uu.sunPosition.value.copy(dir);
      uu.turbidity.value = 3 + rain * 14;
      uu.rayleigh.value = 2.8 + rain * 1.5 - night * 2.4;
      uu.uGain.value = 0.5 * (1 - rain * 0.35);
    }
    this.sky.visible = night < 0.98;
    this.stars.material.opacity = night * (1 - rain);
    this.bloom.strength = 0.25 + night * 0.12;
    this.grade.uniforms.uTint.value.setRGB(1 - night * 0.08, 1 - night * 0.02, 1 + night * 0.08);
    // re-bake reflections when the light changes noticeably
    const key = `${dir.x.toFixed(2)},${dir.y.toFixed(2)},${rain.toFixed(1)}`;
    if (key !== this.lastEnvKey) {
      this.lastEnvKey = key;
      this.envGround.material.color.setScalar(0.25 * (1 - night) + 0.02);
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 500);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = 0.35 + (1 - night) * 0.65;
    }
  }

  setHurt(k) { this.grade.uniforms.uHurt.value = k; }

  resize(w, h) {
    this.composer.setSize(w, h);
    if (this.gtao) this.gtao.setSize(w, h);
  }

  render(camPos, time) {
    this.sky.position.copy(camPos);
    this.stars.position.copy(camPos);
    this.grade.uniforms.uTime.value = time % 100;
    this.composer.render();
  }
}
