import THREE from 'lib/three';
import {GUI} from 'lib/dat.gui';
import {View} from 'view/View';
import {screenService, SCREEN_EVENTS} from 'general/ScreenService';
import store from 'store';
import map from 'lodash/map';
import each from 'lodash/each';
import mouse, {ENUMS as MOUSE_ENUMS} from 'input/Mouse';
import keyboard from 'input/Keyboard';
import Terrain from '../Terrain';
import 'style/dat.gui.styl';
import 'utils/utils';
import Stats from 'vendors/stats.min';
import heightMapURL from 'editor/textures/height_map.png';
import textureMapURL from 'resources/textures/terrain/grass/map.jpg';
import normalMapURL from 'resources/textures/terrain/grass/normal.jpg';
import config from 'editor/editor.json';
import right from 'resources/skyboxes/blueSky/right.jpg';
import left from 'resources/skyboxes/blueSky/left.jpg';
import top from 'resources/skyboxes/blueSky/top.jpg';
import bottom from 'resources/skyboxes/blueSky/bottom.jpg';
import front from 'resources/skyboxes/blueSky/front.jpg';
import back from 'resources/skyboxes/blueSky/back.jpg';
import {LayersView} from 'view/Layers';
import {Canvas} from 'editor/Canvas';
import {EditorMenu} from 'editor/EditorMenu';
import {copySkinnedGroup} from 'utils/copySkinnedGroup';
import {findRootParent} from 'utils/findRootParent';
import {getMeshChildrenArray} from 'utils/getMeshChildrenArray';
import {materialToGUI} from 'utils/materialToGUI';
import {connection} from 'connection';

const assetsContext = 'editor/assets/';
const guiStorageKey = 'editor.gui.r1';
const guiFoldersStorageKey = 'editor.guiFolders.r1';
const assetsStorageKey = 'editor.assets.r1';
const statesStorageKey = 'editor.states.r1';
const terrainHeightStorageKey = 'editor.terrainHeight.r1';
const skyboxImages = [right, left, top, bottom, front, back];

const mouseData = {
  heightDrawingEnabled: false,
  dragVerticalEnabled: false,
  scaleEnabled: false,
  rotationEnabled: false,
  dragEnabled: false,
  dragDelta: null
};

const uv = new THREE.Vector2(0, 0);
const defaultState = {
  profiles: {},
  currentProfile: ''
};

export class EditorView extends View {
  constructor(renderer) {
    super(renderer, defaultState);
    this._mixers = [];
    this._scene = new THREE.Scene();
    this._target = new THREE.Vector3(0, 0, 0);
    this._raycaster = new THREE.Raycaster();
    this._stats = new Stats();
    this._renderTarget = new THREE.WebGLRenderTarget(screenService.width, screenService.height);
    document.body.appendChild(this._stats.dom);

    const promises = [];
    this._initConnection();
    this._createLayers();
    this._createCamera();
    this._createScene();
    promises.push(this._createSkybox(skyboxImages));
    promises.push(this._createHeightCanvas());
    promises.push(this._createTerrain(this)
      .then(this._createGUI.bind(this))
      .then(this._createMenu.bind(this))
    );

    this._promise = Promise.all(promises)
      .then(this._initInput.bind(this))
    // .then(this._test.bind(this));
  }

  _test() {

  }

  stateWillUpdate(state) {
    if (this._serverGUI) {
      this._addServerGUI(this._serverGUI);
    }
  }

  update(delta) {
    if (this._menu.mode === EditorMenu.MODES.TERRAIN_HEIGHT && mouseData.heightDrawingEnabled) {
      this._heightCanvas.draw(uv, delta, keyboard.state.CTRL);
    }

    this._mixers.forEach(mixer => mixer.update(delta / 1000));
    this._transformControls.enabled && this._transformControls.update();

    this._menu.update();
  }

  render(delta) {
    this._stats.begin();

    // this._FPCotrols.update(delta);
    this._terrain.render(delta);
    this._renderer.render(this._scene, this._camera, this._renderTarget);

    this._layers.render();

    this._stats.end();
  }

  destroy() {
    this._resizeUnsubsribe();
  }

  _initConnection() {
    connection.on('state', state => {
      console.log(state);
      this.setState({
        profiles: state.profiles
      });
    });
  }

  _createCamera() {
    const save = store.get('editor.r1.camera');
    // todo: change far to logical value
    this._camera = new THREE.PerspectiveCamera(45, screenService.aspectRatio, 1, 1000000000);
    if (save) {
      this._camera.position.fromArray(save.position);
      this._camera.lookAt(new THREE.Vector3().fromArray(save.target));
    } else {
      this._camera.position.set(0, 1000, 1000);
      this._camera.lookAt(new THREE.Vector3());
    }

    // this._FPCotrols = new THREE.FPControls(this._camera, this._renderer.domElement);
    // this._FPCotrols._speed = 10;

    this._orbitControls = new THREE.OrbitControls(this._camera, this._renderer.domElement, {
      maxPolarAngle: Math.PI / 2
    });
    if (save) {
      this._orbitControls.target = new THREE.Vector3().fromArray(save.target);
      this._orbitControls.update();
    }

    this._transformControls = new THREE.TransformControls(this._camera, this._renderer.domElement);
    this._transformControls.traverse(child => {
      if (child.material) {
        child.material.depthTest = false;
        child.renderOrder = 1;
      }
    });
    this._transformControls.userData.pickers = {
      translate: this._transformControls.children[0].pickers.children,
      rotate: this._transformControls.children[1].pickers.children,
      scale: this._transformControls.children[2].pickers.children
    };
    this._transformControls.enabled = false;
    this._scene.add(this._transformControls);
  }

  _createScene() {
    return new Promise(resolve => {
      const loader = new THREE.TextureLoader();

      this._assets = [];
      this._selectedAsset = null;
      this._spawnAsset = null;
      this._spawnConstructor = null;

      this._ambientLight = new THREE.AmbientLight(0xffffff, 1);
      this._scene.add(this._ambientLight);

      this._directionalLight = new THREE.DirectionalLight(0xffffff, 1);
      this._directionalLight.position.set(1, 1, 1);
      this._scene.add(this._directionalLight);
    });
  }

  _createMenu() {
    this._menu = new EditorMenu(this._camera);
    this._scene.add(this._menu.mesh);
    this._menu.on(EditorMenu.EVENTS.MODE_CHANGED, this._onModeChanged.bind(this));
  }

  _createSkybox(images) {
    return new Promise(resolve => {
      this._scene.background = new THREE.CubeTextureLoader().load(images, resolve);
    });
  }

  _onModeChanged(mode) {
    if (mode !== EditorMenu.MODES.EDIT_ASSETS) {
      this._deselectAsset();
      this._deselectSpawnAsset();
    }
  }

  _initInput() {
    this._initMouse();
    this._initKeyboard();
    this._resizeUnsubsribe = screenService.on(
      SCREEN_EVENTS.RESIZE,
      this._onResize.bind(this)
    );
  }

  _initMouse() {
    const {EVENTS: {DOWN, MOVE, UP}, BUTTONS: {MAIN}} = MOUSE_ENUMS;

    mouse.subscribe(DOWN, ({event}) => {
      const intersects = this._getIntersects(event, this._menu.mesh.children);
      if (intersects.length) {
        this._menu.onClick(intersects);
      } else {
        switch (event.button) {
          case MAIN:
            this._mouseDown(event);
            break;
        }
      }
    }, this._renderer.domElement);

    mouse.subscribe(MOVE, ({event}) => {
      switch (event.button) {
        case MAIN:
          this._mouseUpdate(event);
          break;
      }
    }, this._renderer.domElement);

    mouse.subscribe(UP, ({event}) => {
      switch (event.button) {
        case MAIN:
          this._mouseUp(event);
          break;
      }
    }, this._renderer.domElement);
  }

  _mouseDown(event) {
    switch (this._menu.mode) {
      case EditorMenu.MODES.TERRAIN_HEIGHT:
        const intersects = this._getIntersects(event, [this._terrain.mesh.children[0]]);
        if (intersects.length) {
          uv.copy(intersects[0].uv);
          uv.y = 1 - uv.y;
          mouseData.heightDrawingEnabled = true;
        }
        break;
      case EditorMenu.MODES.EDIT_ASSETS:
        this._selectAssetByIntersect(event);
        break;
    }
  }

  _mouseUpdate(event) {
    switch (this._menu.mode) {
      case EditorMenu.MODES.TERRAIN_HEIGHT:
        if (mouseData.heightDrawingEnabled) {
          const intersects = this._getIntersects(event, [this._terrain.mesh.children[0]]);
          if (intersects.length > 0 && intersects[0].uv) {
            uv.copy(intersects[0].uv);
            uv.y = 1 - uv.y;
          }
        }
        break;
    }

    if (this._spawnAsset) {
      const intersects = this._getIntersects(event, [this._terrain.mesh.children[0]]);
      if (intersects.length > 0 && intersects[0].uv) {
        this._spawnAsset.position.copy(intersects[0].point);
      }
    }
  }

  _mouseUp(event) {
    switch (this._menu.mode) {
      case EditorMenu.MODES.TERRAIN_HEIGHT:
        mouseData.heightDrawingEnabled = false;
        this._selectAssetByIntersect(event);
        break;
    }
  }

  _initKeyboard() {
    keyboard.on('DELETE', () => {
      this._scene.remove(this._selectedAsset);
      this._assets.splice(this._assets.indexOf(this._selectedAsset), 1);
      this._deselectAsset();
    });

    keyboard.on('ESC', () => {
      this._deselectAsset();
      this._deselectSpawnAsset();
    });
    keyboard.on('T', () => this._transformControls.setMode(THREE.TransformControls.TRANSLATE));
    keyboard.on('R', () => this._transformControls.setMode(THREE.TransformControls.ROTATE));
    keyboard.on('S', () => this._transformControls.setMode(THREE.TransformControls.SCALE));
    keyboard.on('C', () => {
      if (this._selectedAsset) {
        const radius = new THREE.Box3().setFromObject(this._selectedAsset).getBoundingSphere().radius * 4;
        const distance = this._selectedAsset.position.distanceTo(this._camera.position);
        this._camera.position
          .sub(this._selectedAsset.position)
          .multiplyScalar(radius / distance)
          .add(this._selectedAsset.position);
        this._orbitControls.target.copy(this._selectedAsset.position);
        this._orbitControls.update();
      }
    });
  }

  _createGUI() {
    const gui = new GUI(store.get(guiFoldersStorageKey))
      .onChange(() => {
        store.set(guiFoldersStorageKey, gui.getFoldersState())
      });
    const createAsset = this._assetsConstructors = {};
    const assetsPromises = [];
    let assetsPromise = null;
    let guiConfig = Object.assign({}, {
      lights: {
        ambient_color: '#ffffff',
        directional_color: '#ffffff',
        ambient_intensity: 1,
        directional_intensity: 1
      }
    }, store.get(guiStorageKey));

    const guiChange = {
      lights: {
        ambient_color: value => {
          this._ambientLight.color.set(value);
        },
        ambient_intensity: value => {
          this._ambientLight.intensity = value;
        },
        directional_color: value => {
          this._directionalLight.color.set(value);
        },
        directional_intensity: value => {
          this._directionalLight.intensity = value;
        }
      },
      save: () => {

        const profile = prompt('Enter profile name', this._state.currentProfile);
        if (profile) {
          const data = {};

          const stateNames = ['_terrain', '_heightCanvas'];
          const states = {};
          stateNames.forEach(stateName => {
            states[stateName] = Object.toStringTypes(this[stateName].getState());
          });

          const assets = map(this._assets, asset => {
            return {
              name: asset.name,
              position: asset.position.toArray(),
              rotation: asset.rotation.toArray(),
              scale: asset.scale.toArray()
            };
          });
          data[guiStorageKey] = guiConfig;

          data[assetsStorageKey] = assets;
          data[statesStorageKey] = states;

          let imageData = this._heightCanvas.getData();
          data[terrainHeightStorageKey] = {
            data: Array.prototype.slice.call(imageData.data),
            width: imageData.width,
            height: imageData.height
          };
          data['editor.r1.camera'] = {
            position: this._camera.position.toArray(),
            target: this._orbitControls.target.toArray()
          };

          connection.emit('save_profile', {profile, data});
        }
      },
      remove: () => {
        if (confirm(`Are you really want to remove "${this._state.currentProfile}" profile?`)) {
          connection.emit('remove_profile', {profile: this._state.currentProfile});
          if (this._state.profiles[this._state.currentProfile]) {
            delete this._state.profiles[this._state.currentProfile];
          }
        }
      },
      reset: () => {
        if (confirm('Are you really want to reset editor?\nAll data will be erased!')) {
          localStorage.clear();
          location.reload();
        }
      }
    };


    this._serverGUI = gui.addFolder('Server')
      .onChange(gui.touch);
    gui.applyFolderState(this._serverGUI);

    this._terrainSkinsGUI = gui.addFolder('Terrrain skins')
      .onChange(gui.touch);
    gui.applyFolderState(this._terrainSkinsGUI);
    const skinsInfo = this._loadTerrainSkins();
    skinsInfo.promise.then(() => {
      const material = this._terrain.mesh.children[0].material;
      const repeat = {repeat: 200};

      this._terrainSkinsGUI.add(skinsInfo, 'defaultSkin', Object.keys(skinsInfo.skins))
        .onChange(skin => {
          material.map = skinsInfo.skins[skin].map;
          material.normalMap = skinsInfo.skins[skin].normalMap;
          material.map.wrapS = material.map.wrapT =
            material.normalMap.wrapS = material.normalMap.wrapT = THREE.RepeatWrapping;
          material.map.repeat.set(repeat.repeat, repeat.repeat);
          material.normalMap.repeat.set(repeat.repeat, repeat.repeat);
        });
      this._terrainSkinsGUI.add(repeat, 'repeat', 1, 300)
        .onChange(repeat => {
          material.map.repeat.set(repeat, repeat);
          material.normalMap.repeat.set(repeat, repeat);
        });
    });

    gui.addState('Map', this._terrain);
    gui.addState('Brush', this._heightCanvas);

    const lights = gui.addFolder('Lights')
      .onChange(gui.touch);
    gui.applyFolderState(lights);

    lights.addColor(guiConfig.lights, 'ambient_color')
      .onChange(guiChange.lights.ambient_color)
      .listen();
    lights.addColor(guiConfig.lights, 'directional_color')
      .onChange(guiChange.lights.directional_color)
      .listen();
    lights.add(guiConfig.lights, 'ambient_intensity', 0, 2)
      .onChange(guiChange.lights.ambient_intensity)
      .listen();
    lights.add(guiConfig.lights, 'directional_intensity', 0, 2)
      .onChange(guiChange.lights.directional_intensity)
      .listen();

    const spawnConfig = {
      scale: {
        min: 1,
        max: 1
      },
      rotation: true
    };
    const spawn = gui.addFolder('Spawn asset')
      .onChange(gui.touch);
    gui.applyFolderState(spawn);
    spawn.add(spawnConfig, 'rotation');
    spawn.add(spawnConfig.scale, 'min', 0, 2, 0.05)
      .name('scale (min)')
      .onChange(value => {
        if (value > spawnConfig.scale.max) {
          spawnConfig.scale.max = value;
        }
      })
      .listen();
    spawn.add(spawnConfig.scale, 'max', 0, 2, 0.05)
      .name('scale (max)')
      .onChange(value => {
        if (value < spawnConfig.scale.min) {
          spawnConfig.scale.min = value;
        }
      })
      .listen();

    this._loadAssets(config.assets, spawn, gui, assetsPromises, createAsset, spawnConfig);
    assetsPromise = Promise.all(assetsPromises);
    assetsPromise.then(this._addServerGUI.bind(this, this._serverGUI));


    const materialsGUI = gui.addFolder('Materials')
      .onChange(gui.touch);
    gui.applyFolderState(materialsGUI);

    assetsPromise.then(() => {
      const materialsList = [];
      each(createAsset, createAsset => {
        createAsset().traverse(child => {
          if (child.material && materialsList.indexOf(child.material) === -1) {
            materialsList.push(child.material);
            materialToGUI(child.material, gui, materialsGUI, `${child.material.name} [${child.name}]`);
          }
        });
      });

    });

    gui.add(guiChange, 'save');
    gui.add(guiChange, 'remove');
    gui.add(guiChange, 'reset');

    this._guiApply(guiConfig, guiChange);
  }

  _addServerGUI(gui) {
    this._profileGUI && this._profileGUI.remove();
    this._profileGUI = gui
      .add(this._state, 'currentProfile', Object.keys(this._state.profiles))
      .name('profile')
      .onChange(this._changeProfile.bind(this))
      .listen();
  }

  _changeProfile(value) {
    const profile = this._state.profiles[value];
    if (profile) {

      const states = profile[statesStorageKey];
      for (let key in states) {
        if (states.hasOwnProperty(key)) {
          this[key].setState(Object.parseStringTypes(states[key]));
        }
      }

      const imageData = profile[terrainHeightStorageKey];
      if (imageData) {
        this._heightCanvas.setData(imageData);
      }

      while (this._assets.length) {
        this._scene.remove(this._assets.pop());
      }
      const loadedAssets = profile[assetsStorageKey];
      if (loadedAssets) {
        loadedAssets.forEach(asset => {
          const mesh = this._assetsConstructors[asset.name]();
          mesh.position.fromArray(asset.position);
          mesh.rotation.fromArray(asset.rotation);
          mesh.scale.fromArray(asset.scale);
          this._scene.add(mesh);
          this._assets.push(mesh);
        });
      }
      this._selectedAsset = null;

      // todo: fix light save
      // const loadedConfig = profile[guiStorageKey];
      // if (loadedConfig) {
      //   Object.extend(, loadedConfig);
      //   this._guiApply(guiConfig, guiChange);
      // }

      const camera = profile['editor.r1.camera'];
      this._camera.position.fromArray(camera.position);
      this._orbitControls.target = new THREE.Vector3().fromArray(camera.target);
      this._orbitControls.update();

      // for (let key in states) {
      //   if (states.hasOwnProperty(key)) {
      //     this[key].setState(Object.parseStringTypes(states[key]));
      //   }
      // }
    }
  }

  _loadAssets(assetsURLs, gui, rootGUI, promises, assets, spawnConfig) {
    each(assetsURLs, (value, key) => {
      if (typeof value === 'string') {
        promises.push(new Promise(resolve => {
          new THREE.FBXLoader().load(assetsContext + value, mesh => {

            if (mesh.animations && mesh.animations.length) {
              mesh.mixer = new THREE.AnimationMixer(mesh);
              this._mixers.push(mesh.mixer);
              mesh.animation = mesh.mixer.clipAction(mesh.animations[0]).play();
              mesh = {
                animations: mesh.animations,
                clone: copySkinnedGroup.bind(null, mesh)
              };
            }

            assets[key] = () => {

              let clone = mesh.clone();

              if (mesh.animations && mesh.animations.length) {
                clone.mixer = new THREE.AnimationMixer(clone);
                this._mixers.push(clone.mixer);
                clone.animation = clone.animation = clone.mixer.clipAction(mesh.animations[0]);
                clone.animation.startAt(-Math.random() * 3);
                clone.animation.play();

                // todo: fix that hack somehow
                const group = new THREE.Group();
                clone.scale.multiplyScalar(1 / 39.370079040527344);
                clone = group.add(clone);
              }

              clone.name = key;

              return clone;
            };

            const guiObject = {
              [key]: this._setSpawnAsset.bind(this, assets[key], spawnConfig)
            };

            gui.add(guiObject, key);
            resolve();
          });
        }));
      } else {
        const folder = gui.addFolder(key)
          .onChange(rootGUI.touch);
        rootGUI.applyFolderState(folder);
        this._loadAssets(value, folder, rootGUI, promises, assets, spawnConfig);
      }
    });
  }

  _setSpawnAsset(createAsset, spawnConfig) {
    if (this._menu.mode !== EditorMenu.MODES.EDIT_ASSETS) {
      this._menu.mode = EditorMenu.MODES.EDIT_ASSETS;
    }

    this._deselectAsset();
    this._deselectSpawnAsset();

    this._spawnAsset = createAsset();
    this._spawnAsset.traverse(child => {
      if (child.material) {
        const material = child.material;
        const attributes = ['map', 'alphaMap', 'normalMap', 'transparent', 'opacity', 'side'];
        child.material = new THREE.MeshPhysicalMaterial();
        attributes.forEach(map => {
          if (material[map]) child.material[map] = material[map];
        });
      }
    });
    this._randomSpawnAsset(spawnConfig);

    this._spawnConstructor = () => {
      const asset = createAsset();
      asset.position.copy(this._spawnAsset.position);
      asset.rotation.copy(this._spawnAsset.rotation);
      asset.scale.copy(this._spawnAsset.scale);
      this._randomSpawnAsset(spawnConfig);
      return asset;
    };
    this._scene.add(this._spawnAsset);
  }

  _deselectSpawnAsset() {
    if (this._spawnAsset) {
      this._spawnAsset.traverse(child => {
        child.material && child.material.dispose();
      });
      this._scene.remove(this._spawnAsset);
      this._spawnAsset = null;
    }
  }

  _randomSpawnAsset(spawnConfig) {
    const {scale: {min, max}, rotation} = spawnConfig;
    const scale = (max - min) * Math.random() + min;

    this._spawnAsset.scale.set(scale, scale, scale);
    if (rotation) {
      this._spawnAsset.rotation.y = Math.PI * 2 * Math.random();
    }
  }

  _guiApply(guiConfig, guiChange) {
    Object.keys(guiChange).forEach(key => {
      if (typeof guiChange[key] === 'object') {
        this._guiApply(guiConfig[key], guiChange[key]);
      } else if (guiConfig[key]) {
        guiChange[key](guiConfig[key]);
      }
    });
  }

  _getPosition({x, y}) {
    const vector = new THREE.Vector3();

    vector.set(
      (x / screenService.width) * 2 - 1,
      -(y / screenService.height) * 2 + 1,
      0.5
    );

    vector.unproject(this._camera);

    const position = this._camera.position.clone();
    const dir = vector.sub(position).normalize();

    const distance = -position.y / dir.y;

    return position.add(dir.multiplyScalar(distance));
  }

  _selectAssetByIntersect(event) {
    const intersectsTransformControls = this._transformControls.enabled
      && this._getIntersects(event, this._transformControls.userData.pickers[this._transformControls.getMode()]).length > 0;

    console.log(this._transformControls.getMode());
    console.log(this._getIntersects(event, this._transformControls.userData.pickers[this._transformControls.getMode()]));
    if (!intersectsTransformControls) {

      const intersects = this._getIntersects(event, getMeshChildrenArray(this._assets));

      if (intersects.length) {
        this._selectAsset(intersects[0].object);
        this._deselectSpawnAsset();
      } else {
        this._deselectAsset();
        if (this._spawnAsset) {
          const asset = this._spawnConstructor();
          this._assets.push(asset);
          this._scene.add(asset);
        }
      }
    }
  }

  _selectAsset(asset) {
    this._selectedAsset = findRootParent(asset);
    this._transformControls.attach(this._selectedAsset);
    this._transformControls.enabled = true;
  }

  _deselectAsset() {
    if (this._selectedAsset) {
      this._transformControls.enabled = false;
      this._transformControls.detach();
    }
  }

  _createTerrain() {
    const maps = {
      heightMapURL,
      textureMapURL,
      normalMapURL,
      heightCanvas: this._heightCanvas
    };
    const size = new THREE.Vector3(2000, 400, 2000);
    const water = {};
    const env = {
      renderer: this._renderer,
      camera: this._camera,
      fog: null,
      light: this._directionalLight
    };

    return new Promise(resolve => {
      this._terrain = new Terrain({maps, env, size, water});
      this._terrain.onLoad(mesh => {
        this._scene.add(mesh);
        resolve();
      });
    });
  }

  _createLayers() {
    this._layers = new LayersView(this._renderer);
    this._layers.addLayer(this._renderTarget);
  }

  _getIntersects(event, objects) {
    const {x, y} = new THREE.Vector2(event.clientX, event.clientY);
    const vector = new THREE.Vector2(
      (x / screenService.width) * 2 - 1,
      -(y / screenService.height) * 2 + 1,
    );

    this._raycaster.setFromCamera(vector, this._camera);
    return this._raycaster.intersectObjects(objects);
  };

  _createHeightCanvas() {
    return new Promise(resolve => {
      this._heightCanvas = new Canvas(64, 64);
      this._heightCanvas.onLoad(resolve);
    });
  }

  _loadTerrainSkins() {
    const skinsPromises = [];
    const skins = {};
    const loader = new THREE.TextureLoader();

    config.terrain.skins.forEach(skin => {
      skins[skin] = {};
      skinsPromises.push(new Promise(resolve => {
        skins[skin].map = loader.load(`resources/textures/terrain/${skin}/map.jpg`, resolve)
      }));
      skinsPromises.push(new Promise(resolve => {
        skins[skin].normalMap = loader.load(`resources/textures/terrain/${skin}/normal.jpg`, resolve)
      }));
    });
    return {
      promise: Promise.all(skinsPromises),
      skins: skins,
      defaultSkin: ''
    }
  }
}