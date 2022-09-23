/*
 Copyright (c) 2020 Xiamen Yaji Software Co., Ltd.

 https://www.cocos.com/

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated engine source code (the "Software"), a limited,
 worldwide, royalty-free, non-assignable, revocable and non-exclusive license
 to use Cocos Creator solely to develop games on your target platforms. You shall
 not use Cocos Creator software for developing other software or tools that's
 used for developing games. You are not granted to publish, distribute,
 sublicense, and/or sell copies of Cocos Creator.

 The software or tools in this License Agreement are licensed, not sold.
 Xiamen Yaji Software Co., Ltd. reserves all rights not expressly granted to you.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 */
import { EDITOR } from 'internal:constants';
import { CCBoolean, CCFloat, Color, Enum, Layers, Material, Quat, Rect, ReflectionProbeManager, RenderPipeline, Root, Texture2D, toRadian, Vec3 } from '../..';
import { RenderTexture } from '../../assets/render-texture';
import { Component } from '../../components/component';
import { property } from '../../data/class-decorator';
import { ccclass, editable, executeInEditMode, menu, playOnFocus, readOnly, serializable, tooltip, type, visible } from '../../data/decorators';
import { Director, director } from '../../director';
import { deviceManager, Framebuffer, Texture } from '../../gfx';
import { BufferTextureCopy, ClearFlagBit, ColorAttachment, DepthStencilAttachment, Format, RenderPassInfo } from '../../gfx/base/define';
import { legacyCC } from '../../global-exports';
import { CAMERA_DEFAULT_MASK } from '../../pipeline/define';
import { Camera, CameraAperture, CameraFOVAxis, CameraISO, CameraProjection, CameraShutter, CameraType, SKYBOX_FLAG, TrackingType } from './camera';

export const ProbeResolution = Enum({
    /**
     * @zh 分辨率 128 * 128。
     * @en renderTexture resolution 128 * 128.
     * @readonly
     */
    Low_128x128: 128,
    /**
     * @zh 分辨率 256 * 256。
     * @en renderTexture resolution 256 * 256.
     * @readonly
     */
    Low_256x256: 256,

    /**
      * @zh 分辨率 512 * 512。
      * @en renderTexture resolution 512 * 512.
      * @readonly
      */
    Medium_512x512: 512,

    /**
      * @zh 分辨率 1024 * 1024。
      * @en renderTexture resolution 1024 * 1024.
      * @readonly
      */
    High_1024x1024: 1024,

    /**
      * @zh 分辨率 2048 * 2048。
      * @en renderTexture resolution 2048 * 2048.
      * @readonly
      */
    Ultra_2048x2048: 2048,
});
export const ProbeClearFlag = Enum({
    SKYBOX: SKYBOX_FLAG | ClearFlagBit.DEPTH_STENCIL,
    SOLID_COLOR: ClearFlagBit.ALL,
});
export const ProbeType = Enum({
    BAKE: 0,
    REALTIME: 1,
});
const cameraDir: Vec3[] = [
    new Vec3(0, -90, 0),
    new Vec3(0, 90, 0),
    new Vec3(90, 0, 0),
    new Vec3(-90, 0, 0),
    new Vec3(0, 0, 0),
    new Vec3(0, 180, 0),
];
enum ProbeFaceIndex {
    right = 0,
    left = 1,
    top = 2,
    bottom = 3,
    front = 4,
    back = 5,
}
declare const Editor: any;
@ccclass('cc.ReflectionProbe')
@menu('Rendering/ReflectionProbe')
@executeInEditMode
@playOnFocus
export class ReflectionProbe extends Component {
    @serializable
    protected _generate = false;

    @serializable
    protected _size = 1024;
    @serializable
    protected _clearFlag = ProbeClearFlag.SKYBOX;

    @serializable
    protected _backgroundColor = new Color(0, 0, 0, 255);
    @serializable
    protected _visibility = CAMERA_DEFAULT_MASK;

    @serializable
    protected _near = 1;

    @serializable
    protected _far = 1000;

    @serializable
    protected _probeType = ProbeType.BAKE;

    @serializable
    protected _fov = 90;

    @property([Material])
    materials: Material[] = [];

    private _camera: Camera | null = null;

    public realtimeTextures: Texture[] = [];

    private _fullPath = 'D:/cocosProject/cocos-task/TestProject/assets/renderTexture/';

    public framebuffer: Framebuffer[] = [];
    public static probeFaceIndex = ProbeFaceIndex;

    @readOnly
    @type(CCBoolean)
    set generate (val) {
        console.log(`generate=====${val}`);
        this._generate = val;
        if (val) {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this.startCapture();
        }
    }
    get generate () {
        return this._generate;
    }

    @type(ProbeType)
    set probeType (value: number) {
        this._probeType = value;
    }
    get probeType () {
        return this._probeType;
    }
    /**
     * @en set texture size
     * @zh 设置纹理大小
     */
    @type(ProbeResolution)
    set resolution (value: number) {
        console.log(`resolution = ${value}`);
        this._size = value;
    }
    get resolution () {
        return this._size;
    }
    @type(ProbeClearFlag)
    set clearFlag (value: number) {
        this._clearFlag = value;
        this._camera!.clearFlag = this._clearFlag;
    }
    get clearFlag () {
        return this._clearFlag;
    }
    // eslint-disable-next-line func-names
    @visible(function (this: ReflectionProbe) { return this._clearFlag === ProbeClearFlag.SOLID_COLOR; })
    @type(Color)
    set backgroundColor (val: Color) {
        this._backgroundColor = val;
    }
    get backgroundColor () {
        return this._backgroundColor;
    }
    /**
     * @en Visibility mask, declaring a set of node layers that will be visible to this camera.
     * @zh 可见性掩码，声明在当前相机中可见的节点层级集合。
     */
    @type(Layers.BitMask)
    @tooltip('i18n:camera.visibility')
    get visibility () {
        return this._visibility;
    }

    set visibility (val) {
        this._visibility = val;
    }

    @type(CCFloat)
    set fov (val) {
        this._fov = val;
        this._camera!.fov = toRadian(this._fov);
    }
    get fov () {
        return this._fov;
    }

    @type(CCFloat)
    set near (val) {
        this._near = val;
        this._camera!.nearClip = this._near;
    }
    get near () {
        return this._near;
    }

    @type(CCFloat)
    set far (val) {
        this._far = val;
        this._camera!.farClip = this._far;
    }
    get far () {
        return this._far;
    }

    get camera () {
        return this._camera;
    }

    public onLoad () {
        this._createCamera();
    }

    public onEnable () {
        if (!EDITOR) {
            ReflectionProbeManager.probeManager.register(this);
        }
        //attach camera to scene
        if (!this.node.scene || !this._camera) {
            return;
        }
        if (this._camera && this._camera.scene) {
            this._camera.scene.removeCamera(this._camera);
        }
        const rs = this._getRenderScene();
        rs.addCamera(this._camera);
    }
    public start () {
        if (!EDITOR) {
            this.scheduleOnce(() => {
                for (let i = 0; i < this.materials.length; i++) {
                    const mat = this.materials[i];
                    mat.setProperty('mainTexture', this.framebuffer[i].colorTextures[0]);
                }
            }, 1.0);
        }
    }
    public onDestroy () {
        if (this._camera) {
            this._camera.destroy();
            this._camera = null;
        }
        for (let i = 0; i < this.framebuffer.length; i++) {
            const frameBuffer = this.framebuffer[i];
            if (!frameBuffer) { continue; }
            const renderTargets = frameBuffer.colorTextures;
            for (let j = 0; j < renderTargets.length; j++) {
                const renderTarget = renderTargets[j];
                if (renderTarget) { renderTarget.destroy(); }
            }
            frameBuffer.renderPass.destroy();
            frameBuffer.destroy();
        }
        this.framebuffer = [];
    }
    public update (dt: number) {
    }
    /* eslint-disable no-await-in-loop */
    public async startCapture () {
        // enum FaceIndex {
        //     right = 0,
        //     left = 1,
        //     top = 2,
        //     bottom = 3,
        //     front = 4,
        //     back = 5,
        // }
        const isHDR = (legacyCC.director.root as Root).pipeline.pipelineSceneData.isHDR;
        const files:string[] = [];
        for (let faceIdx = 0; faceIdx < 6; faceIdx++) {
            this.updateCameraDir(faceIdx);
            const rt = this._createTargetTexture();
            this._setTargetTexture(rt);
            await this.waitForNextFrame();
            let pixelData = this.readPixels(rt);
            rt.destroy();
            pixelData = this.flipImage(pixelData, this._size, this._size);
            if (isHDR) {
                const fileName = `capture_${faceIdx}.data`;
                const fullPath = this._fullPath + fileName;
                await EditorExtends.Asset.saveHDRDataToImage(pixelData, this._size, this._size, fullPath, (params: any) => {
                    files.push(params);
                });
            } else {
                const fileName = `capture_${faceIdx}.png`;
                const fullPath = this._fullPath + fileName;
                await EditorExtends.Asset.saveDataToImage(pixelData, this._size, this._size, fullPath, (params: any) => {
                    files.push(params);
                });
            }
        }
        await Editor.Message.request('scene', 'execute-scene-script', {
            name: 'inspector',
            method: 'bakeReflectionProbe',
            args: [files, isHDR],
        });
        this.updateCameraDir(ReflectionProbe.probeFaceIndex.front);
    }
    public async waitForNextFrame () {
        return new Promise<void>((resolve, reject) => {
            director.once(Director.EVENT_END_FRAME, () => {
                resolve();
            });
        });
    }

    private _createCamera () {
        if (!this._camera) {
            this._camera = (legacyCC.director.root as Root).createCamera();
            this._camera.initialize({
                name: this.node.name,
                node: this.node,
                projection: CameraProjection.PERSPECTIVE,
                window: legacyCC.director.root && legacyCC.director.root.mainWindow,
                priority: 0,
                cameraType: CameraType.REFLECTION_PROBE,
                trackingType: TrackingType.NO_TRACKING,
            });
        }
        this._camera.setViewportInOrientedSpace(new Rect(0, 0, 1, 1));
        this._camera.fovAxis = CameraFOVAxis.VERTICAL;
        this._camera.fov = toRadian(this._fov);
        this._camera.orthoHeight = 10;
        this._camera.nearClip = this._near;
        this._camera.farClip = this._far;
        this._camera.clearColor = this._backgroundColor;
        this._camera.clearDepth = 1.0;
        this._camera.clearStencil = 0.0;
        this._camera.clearFlag = this._clearFlag;
        this._camera.visibility = this._visibility;
        this._camera.aperture = CameraAperture.F16_0;
        this._camera.shutter = CameraShutter.D125;
        this._camera.iso = CameraISO.ISO100;
        this._camera.position = this.node.position;
        this._camera.enabled = true;
        this._camera.update(true);
        return this._camera;
    }
    private _createTargetTexture () {
        const width = this._size;
        const height = this._size;
        const rt = new RenderTexture();
        const isHDR = (legacyCC.director.root as Root).pipeline.pipelineSceneData.isHDR;
        if (isHDR) {
            const colorAttachment = new ColorAttachment();
            colorAttachment.format = Format.RGBA32F;
            const depthStencilAttachment = new DepthStencilAttachment();
            depthStencilAttachment.format = Format.DEPTH_STENCIL;
            const passInfo = new RenderPassInfo([colorAttachment], depthStencilAttachment);
            rt.reset({ width, height, passInfo });
        } else {
            rt.reset({ width, height });
        }
        return rt;
    }

    private _setTargetTexture (rt:RenderTexture) {
        if (!this._camera) {
            return;
        }
        if (rt) {
            const window = rt.window;
            this._camera.changeTargetWindow(window);
            this._camera.setFixedSize(window!.width, window!.height);
        }
    }
    public readPixels (rt: RenderTexture): Uint8Array | Float32Array | null {
        const isHDR = (legacyCC.director.root as Root).pipeline.pipelineSceneData.isHDR;

        const width = rt.width;
        const height = rt.height;

        const needSize = 4 * width * height;
        let buffer: Uint8Array | Float32Array;
        if (isHDR) {
            buffer = new Float32Array(needSize);
        } else {
            buffer = new Uint8Array(needSize);
        }

        const gfxTexture = rt.getGFXTexture();
        if (!gfxTexture) {
            return null;
        }

        const gfxDevice = deviceManager.gfxDevice;

        const bufferViews: ArrayBufferView[] = [];
        const regions: BufferTextureCopy[] = [];

        const region0 = new BufferTextureCopy();
        region0.texOffset.x = 0;
        region0.texOffset.y = 0;
        region0.texExtent.width = rt.width;
        region0.texExtent.height = rt.height;
        regions.push(region0);

        bufferViews.push(buffer);
        gfxDevice?.copyTextureToBuffers(gfxTexture, bufferViews, regions);
        return buffer;
    }

    public flipImage (data: Uint8Array | Float32Array | null, width: number, height: number) {
        if (!data) {
            return null;
        }
        const isHDR = (legacyCC.director.root as Root).pipeline.pipelineSceneData.isHDR;
        let newData: Uint8Array | Float32Array;
        if (isHDR) {
            newData = new Float32Array(data.length);
        } else {
            newData = new Uint8Array(data.length);
        }
        for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
                const index = (width * i + j) * 4;
                const newIndex = (width * (height - i - 1) + j) * 4;
                newData[newIndex] = data[index];
                newData[newIndex + 1] = data[index + 1];
                newData[newIndex + 2] = data[index + 2];
                newData[newIndex + 3] = data[index + 3];
            }
        }
        return newData;
    }
    public isFrameBufferInitFinished () {
        return this.framebuffer.length === 6;
    }
    public updateCameraDir (faceIdx:number) {
        this.node.setRotationFromEuler(cameraDir[faceIdx]);
        if (this._camera) {
            this._camera.update(true);
        }
    }
    public isFinishedRendering () {
    }
    public renderProbe () {

    }
}
