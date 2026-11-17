import * as THREE from 'three';
import type { QualitySettings } from '../app/settings';

/**
 * Rendering engine. It owns the Three.js scene, camera and lighting and knows
 * nothing about vehicle physics: it renders whatever state the simulation
 * worker produced.
 */
export class EngineRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;

  private quality: QualitySettings;
  private basePixelRatio = 1;
  private renderScale = 1;

  constructor(canvas: HTMLCanvasElement, quality: QualitySettings) {
    this.quality = quality;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.08, 900);
    this.camera.position.set(9, 3.4, -14);

    this.scene.background = new THREE.Color(0xa9bfcd);
    this.scene.fog = new THREE.Fog(0xa9bfcd, 130, 620);

    this.buildSky();
    this.sun = this.buildLights();

    this.applyQuality(quality);
    window.addEventListener('resize', this.handleResize);
  }

  private buildSky(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (context) {
      const gradient = context.createLinearGradient(0, 0, 0, 256);
      gradient.addColorStop(0, '#12314f');
      gradient.addColorStop(0.42, '#5c86a9');
      gradient.addColorStop(0.7, '#a8bfd0');
      gradient.addColorStop(0.88, '#cfdae1');
      gradient.addColorStop(1, '#e3e9ec');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 8, 256);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(760, 32, 16),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    this.scene.add(sky);
  }

  private buildLights(): THREE.DirectionalLight {
    const sun = new THREE.DirectionalLight(0xfff2e2, 2.7);
    sun.position.set(70, 95, 45);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(this.quality.shadowMapSize);
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 320;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;

    const hemisphere = new THREE.HemisphereLight(0xbfd9f0, 0x3c4248, 0.8);
    const bounce = new THREE.DirectionalLight(0xdfe9f2, 0.25);
    bounce.position.set(-60, 40, -70);

    this.scene.add(sun, sun.target, hemisphere, bounce);
    return sun;
  }

  applyQuality(quality: QualitySettings): void {
    this.quality = quality;
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap) * quality.renderScale;
    this.setRenderScale(1);
    this.renderer.shadowMap.enabled = quality.shadows;
    this.sun.castShadow = quality.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    if (this.sun.shadow.mapSize.width !== quality.shadowMapSize) {
      this.sun.shadow.mapSize.setScalar(quality.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.resize();
  }

  /**
   * Adaptive resolution: scales the framebuffer only. Simulation accuracy is
   * untouched, so a weak GPU loses pixels, never physics fidelity.
   */
  setRenderScale(scale: number): void {
    this.renderScale = Math.max(0.4, Math.min(1, scale));
    this.renderer.setPixelRatio(Math.max(0.4, this.basePixelRatio * this.renderScale));
    this.resize();
  }

  get currentRenderScale(): number {
    return this.renderScale;
  }

  /** Keep the shadow frustum centred on the action without moving the light angle. */
  focusShadow(target: THREE.Vector3): void {
    this.sun.position.set(target.x + 70, 95, target.z + 45);
    this.sun.target.position.set(target.x, 0, target.z);
    this.sun.target.updateMatrixWorld();
  }

  get maxAnisotropy(): number {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  private handleResize = (): void => {
    this.resize();
  };

  resize(): void {
    const width = window.innerWidth;
    const height = Math.max(1, window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.renderer.dispose();
  }
}
