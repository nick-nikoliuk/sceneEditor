import THREE from 'lib/three';
import Mesh from 'common/Mesh';
import terrainHeightIcon from 'editor/icons/terrain_height.jpg';
import editAssetsIcon from 'editor/icons/edit_assets.jpg';

const MENU_RENDER_ORDER = 10;
const ITEM_Y = -0.72;

export class EditorMenu extends Mesh {
  constructor(camera) {
    super();
    const itemSize = 0.14;
    const itemsMargin = 0.05;
    const items = this.items = [{
      mode: EditorMenu.MODES.TERRAIN_HEIGHT,
      texture: terrainHeightIcon
    },{
      mode: EditorMenu.MODES.EDIT_ASSETS,
      texture: editAssetsIcon
    }
    ];
    const itemsWidth = items.length * itemSize + (items.length - 1) * itemsMargin;
    const textureLoader = new THREE.TextureLoader();

    const group = new THREE.Scene();

    items.forEach((item, index) => {
      textureLoader.load(item.texture, (map) => {
        const x = index * (itemsMargin + itemSize) - itemsWidth / 2;
        const cube = new THREE.Mesh(
          new THREE.CubeGeometry(itemSize, itemSize, itemSize),
          new THREE.MeshLambertMaterial({
            map,
            transparent: true,
            depthTest: false,
            depthWrite: false
          })
        );
        cube.position.set(x + itemSize / 2, ITEM_Y, 0);
        cube.mode = item.mode;
        group.add(cube);
      });
    });

    group.renderOrder = MENU_RENDER_ORDER;

    this._camera = camera;
    this._mesh = group;
    this._selectedIndex = 1;
    this._mode = items[this._selectedIndex].mode;
  }

  update() {
    const lengthToCamera = 2;

    const lookAtVector = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(this._camera.quaternion)
      .normalize()
      .multiplyScalar(lengthToCamera);

    this._mesh.position
      .copy(this._camera.position)
      .add(lookAtVector);

    this._mesh.lookAt(this._camera.position);
    this._mesh.children.forEach((child, index) => {
      child.material.opacity = index === this._selectedIndex ? 1 : 0.5;
      const y = index === this._selectedIndex ? 0 : child.position.y;
      const cameraPosition = new THREE.Vector3(child.position.x, y, lengthToCamera);
      child.lookAt(cameraPosition);
    });
  }

  onClick(intersects) {
    const item = intersects[0].object;
    this.mode = item.mode;
  }

  get mode() {
    return this._mode;
  }

  set mode(mode) {
    if (this._mode !== mode) {
      this._mode = mode;
      this.emit(EditorMenu.EVENTS.MODE_CHANGED, this._mode);
    }
    this.items.forEach((item, index) => {
      if (mode === item.mode) {
        this._selectedIndex = index;
      }
    });
    this._mode = mode;
  }
}

EditorMenu.MODES = {
  TERRAIN_HEIGHT: 1,
  TERRAIN_TEXTURE: 2,
  EDIT_ASSETS: 3
};

EditorMenu.EVENTS = {
  MODE_CHANGED: 1
};