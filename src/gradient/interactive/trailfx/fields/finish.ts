import { g, opt, p } from './spec';
import { uniformsFor } from './chunks';
import type { TrailFxColorDef, TrailFxParamDef } from '../model';

/* Finish passes: they read the picture so far, so they work after any pass in the stack (including the original Chrome trail). */

export interface FinishSpec {
  id: string; label: string; icon: string; blurb: string;
  params: TrailFxParamDef[];
  colors?: TrailFxColorDef;
  frag: string;
}

const HEAD = `#version 300 es
precision highp float;
in vec2 vTextureCoord;
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uClock;
out vec4 fragColor;
float ASP(){return uResolution.x/uResolution.y;}
float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float lumOf(vec3 c){return dot(c,vec3(.299,.587,.114));}
`;
const build = (params: TrailFxParamDef[], body: string, extra = '') => `${HEAD}${uniformsFor(params.map(x => x.key))}${extra}${body}`;

const bloomParams = [
  p('threshold', 'Threshold', 0, 1, 0.55), p('intensity', 'Intensity', 0, 3, 1), p('radius', 'Spread', 0.002, 0.08, 0.025, 0.001),
  p('chroma', 'Colour fringe', 0, 1, 0, 0.01), p('keep', 'Keep the sharp image', 0, 1, 1),
];
const filmParams = [
  p('grain', 'Film grain', 0, 1, 0.35), p('grainSize', 'Grain size', 0.5, 4, 1.2, 0.1), p('vignette', 'Vignette', 0, 1, 0.4),
  p('aberration', 'Lens fringing', 0, 1, 0.3), p('scan', 'Scanlines', 0, 1, 0), p('fade', 'Faded blacks', 0, 0.4, 0.04, 0.005), p('flicker', 'Flicker', 0, 1, 0),
];
const crispParams = [
  p('amount', 'Sharpen', 0, 3, 0.8), p('radius', 'Sharpen radius', 0.5, 4, 1.4, 0.1, 'px'), p('clarity', 'Clarity', 0, 1, 0.3), p('saturation', 'Saturation', 0.5, 1.8, 1.1), p('vibrance', 'Vibrance', 0, 1, 0.2),
];
const toneParams = [
  p('amount', 'Amount', 0, 1, 0.55), p('balance', 'Balance', -1, 1, 0), p('exposure', 'Exposure', -1, 1, 0), p('gamma', 'Midtones', 0.5, 2, 1),
  opt('keepLum', 'Keep brightness', ['No', 'Yes'], 1),
];
const rayParams = [
  ...g('Source', [
    opt('source', 'Light source', ['Point', 'Directional'], 0),
    p('centerX', 'Position X', 0, 1, 0.5, 0.01, undefined, { when: { key: 'source', in: [0] } }),
    p('centerY', 'Position Y', 0, 1, 0.35, 0.01, undefined, { when: { key: 'source', in: [0] } }),
    p('direction', 'Direction', -180, 180, 45, 1, '°', { when: { key: 'source', in: [1] } }),
  ]),
  ...g('Rays', [
    p('threshold', 'Light threshold', 0, 1, 0.35),
    p('softness', 'Threshold softness', 0.01, 0.8, 0.18, 0.01),
    p('length', 'Ray reach', 0.02, 1.5, 0.7, 0.01, '×'),
    p('decay', 'Ray falloff', 0.7, 1, 0.94, 0.005),
    p('samples', 'Ray detail', 8, 48, 32, 1),
  ]),
  ...g('Output', [p('gain', 'Intensity', 0, 4, 1.2, 0.05)]),
];

export const FINISH_SPECS: FinishSpec[] = [
  {
    id: 'rays', label: 'Light rays', icon: '✴',
    blurb: 'Bright parts of the image cast tinted rays from a movable point light or along a chosen direction.',
    params: rayParams, colors: { label: 'Ray tint', defaults: ['#ffffff'], min: 1, max: 1 },
    frag: build(rayParams, `
uniform vec3 uTint;
void main(){
  vec2 uv=vTextureCoord;
  vec4 base=texture(uTexture,uv);
  vec2 aspect=vec2(ASP(),1.);
  bool pointSource=uSource<.5;
  vec2 toward;
  float reach;
  if(pointSource){
    vec2 delta=(vec2(uCenterX,1.-uCenterY)-uv)*aspect;
    reach=min(length(delta),uLength);
    toward=length(delta)>.0001?normalize(delta):vec2(0.);
  }else{
    float angle=radians(uDirection);
    toward=-vec2(cos(angle),sin(angle));
    reach=uLength;
  }
  vec3 rays=vec3(0.);
  float totalWeight=0.;
  for(int i=0;i<48;i++){
    if(float(i)>=uSamples) break;
    float t=(float(i)+.5)/uSamples;
    vec2 sampleUv=uv+toward*(reach*t)/aspect;
    vec4 source=texture(uTexture,sampleUv);
    vec3 rgb=source.a>.001?source.rgb/source.a:source.rgb;
    float light=smoothstep(uThreshold,uThreshold+uSoftness,lumOf(rgb))*source.a;
    float weight=pow(uDecay,float(i));
    rays+=rgb*light*weight;
    totalWeight+=weight;
  }
  rays=(totalWeight>0.?rays/totalWeight:vec3(0.))*uGain*uTint;
  float rayAlpha=clamp(max(rays.r,max(rays.g,rays.b)),0.,1.);
  fragColor=vec4(base.rgb+rays, max(base.a,rayAlpha));
}`),
  },
  {
    id: 'bloom', label: 'Bloom', icon: '✺',
    blurb: 'Bright parts spill soft light around themselves (a 32-tap jittered gather), with an optional colour fringe.',
    params: bloomParams, colors: { label: 'Bloom tint', defaults: ['#ffffff'], min: 1, max: 1 },
    frag: build(bloomParams, `
uniform vec3 uTint;
void main(){
  vec2 uv=vTextureCoord;vec4 c=texture(uTexture,uv);
  vec2 asp=vec2(1./ASP(),1.);
  float jit=hash21(gl_FragCoord.xy)*6.2831;
  vec3 acc=vec3(0.);float ws=0.;
  for(int ring=0;ring<2;ring++){
    float rr=ring==0?1.:2.6;
    for(int i=0;i<16;i++){
      float fi=float(i);
      float r=sqrt((fi+.5)/16.)*rr;float a=fi*2.39996+jit;
      vec2 o=vec2(cos(a),sin(a))*r*uRadius*asp;
      vec3 s=texture(uTexture,uv+o).rgb;
      if(uChroma>.001){s.r=texture(uTexture,uv+o*(1.+uChroma*.5)).r;s.b=texture(uTexture,uv+o*(1.-uChroma*.5)).b;}
      s*=smoothstep(uThreshold,uThreshold+.3,lumOf(s));
      float w=1.-r/(rr*1.2);acc+=s*w;ws+=w;
    }
  }
  vec3 bloom=acc/max(ws,1e-3)*uIntensity*uTint;
  vec3 base=c.rgb*mix(.35,1.,uKeep);
  fragColor=vec4(base+bloom,max(c.a,clamp(lumOf(bloom),0.,1.)));
}`),
  },
  {
    id: 'film', label: 'Film finish', icon: '🎞',
    blurb: 'Grain, vignette, lens fringing, scanlines, lifted blacks and flicker: the last coat that makes it feel photographed.',
    params: filmParams,
    frag: build(filmParams, `
void main(){
  vec2 uv=vTextureCoord;vec2 q=uv-.5;
  float r2=dot(q*vec2(ASP(),1.),q*vec2(ASP(),1.));
  vec2 off=q*uAberration*.04*r2*4.;
  vec4 c=texture(uTexture,uv);
  vec3 rgb=vec3(texture(uTexture,uv+off).r,c.g,texture(uTexture,uv-off).b);
  float a=c.a;
  rgb*=1.-uScan*(.5+.5*sin(uv.y*uResolution.y*3.14159))*.35;
  float g=hash21(gl_FragCoord.xy/uGrainSize+floor(uClock*24.)*7.13)-.5;
  rgb+=g*uGrain*.35*a*(.5+lumOf(rgb));
  rgb*=1.-uVignette*smoothstep(.15,1.05,length(q*vec2(ASP(),1.))*1.25);
  rgb=mix(rgb,vec3(uFade)*a+rgb*(1.-uFade),step(.001,a)*uFade*2.);
  rgb*=1.+(hash21(vec2(floor(uClock*18.),3.))-.5)*uFlicker*.25;
  fragColor=vec4(max(rgb,0.),a);
}`),
  },
  {
    id: 'crisp', label: 'Crisp & vivid', icon: '◈',
    blurb: 'Unsharp mask, local-contrast clarity, saturation and vibrance: makes the effect look sharper and richer.',
    params: crispParams,
    frag: build(crispParams, `
void main(){
  vec2 uv=vTextureCoord;vec2 px=uRadius/uResolution;
  vec4 c=texture(uTexture,uv);
  vec3 blur=(texture(uTexture,uv+vec2(px.x,0.)).rgb+texture(uTexture,uv-vec2(px.x,0.)).rgb+texture(uTexture,uv+vec2(0.,px.y)).rgb+texture(uTexture,uv-vec2(0.,px.y)).rgb)*.25;
  vec3 wide=(texture(uTexture,uv+px*4.).rgb+texture(uTexture,uv-px*4.).rgb+texture(uTexture,uv+vec2(px.x,-px.y)*4.).rgb+texture(uTexture,uv+vec2(-px.x,px.y)*4.).rgb)*.25;
  vec3 rgb=c.rgb+(c.rgb-blur)*uAmount+(c.rgb-wide)*uClarity;
  float l=lumOf(rgb);
  float mx=max(rgb.r,max(rgb.g,rgb.b)),mn=min(rgb.r,min(rgb.g,rgb.b));
  float sat=mx-mn;
  float k=uSaturation*(1.+uVibrance*(1.-sat));
  rgb=mix(vec3(l),rgb,k);
  fragColor=vec4(clamp(rgb,0.,1.5)*step(.0001,c.a),c.a);
}`),
  },
  {
    id: 'splittone', label: 'Split tone', icon: '◑',
    blurb: 'Tints the shadows with one colour and the highlights with another, with exposure and midtone control.',
    params: toneParams, colors: { label: 'Shadows → highlights', defaults: ['#12206b', '#ffb36b'], min: 2, max: 2 },
    frag: build(toneParams, `
void main(){
  vec2 uv=vTextureCoord;vec4 c=texture(uTexture,uv);
  float a=c.a;vec3 u=a>.001?c.rgb/a:c.rgb;
  u=pow(max(u*exp2(uExposure),0.),vec3(1./uGamma));
  float l=lumOf(u);
  float t=smoothstep(.0,1.,l+uBalance*.5);
  vec3 tone=mix(uPal[0],uPal[1],t);
  vec3 o=mix(u,u*(.4+tone*1.2),uAmount*(1.-.4*t))+tone*uAmount*.08;
  if(uKeepLum>.5) o*=l/max(lumOf(o),1e-3)*.6+.4;
  fragColor=vec4(max(o,0.)*a,a);
}`, 'uniform vec3 uPal[8];\nuniform float uPalN;\n'),
  },
];
