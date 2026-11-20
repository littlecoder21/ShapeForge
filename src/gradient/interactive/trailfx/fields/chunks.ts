import { PALETTE } from '../shaders.generators';
import { cap, type FieldEngine, type FieldSpec } from './spec';

/* GLSL building blocks for the field generators (WebGL2 / GLSL ES 3.00).
 * Coordinates: uv is 0..1 with y up; pointer uniforms use the same space. Distances that must be round are multiplied by ASP(). */

const HEAD = `#version 300 es
precision highp float;
in vec2 vTextureCoord;
uniform sampler2D uTexture;
uniform sampler2D uPingPongTexture;
uniform vec2 uResolution, uMousePos, uPreviousMousePos;
uniform vec3 uClick;
uniform float uClock, uDt, uDown, uSpeed, uActive, uHasInput, uStepI;
out vec4 fragColor;
float ASP(){return uResolution.x/uResolution.y;}
vec2 AS2(){return vec2(ASP(),1.);}
/* frame delta in 60 fps frames, capped so one slow frame cannot wipe the field out */
float FDT(){return clamp(uDt*60.,0.,2.);}
`;

const NOISE = `
float hash11(float n){return fract(sin(n*127.1+311.7)*43758.5453);}
float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
vec2 hash22(vec2 p){float n=hash21(p);return vec2(n,hash21(p+n+19.19));}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),mix(hash21(i+vec2(0.,1.)),hash21(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<5;i++){s+=a*vnoise(p);p=m*p;a*=.5;}return s;}
vec2 rot2(vec2 v,float a){float c=cos(a),s=sin(a);return vec2(c*v.x-s*v.y,s*v.x+c*v.y);}
/* x: distance to the nearest cell edge, y: distance to the nearest point, zw: that point (grid space) */
vec4 voronoi(vec2 p){
  vec2 n=floor(p),f=fract(p);
  float d1=8.,d2=8.;vec2 cen=vec2(0.);
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    vec2 gg=vec2(float(i),float(j));
    vec2 o=hash22(n+gg);
    vec2 r=gg+o-f;
    float dd=dot(r,r);
    if(dd<d1){d2=d1;d1=dd;cen=n+gg+o;}
    else if(dd<d2){d2=dd;}
  }
  return vec4(sqrt(d2)-sqrt(d1),sqrt(d1),cen);
}
`;

/** the pointer, as a brush: x = energy this frame, yz = energy × direction of travel */
const BRUSH = `
vec3 brush(vec2 uv){
  if(uStepI>.5) return vec3(0.);
  vec2 AS=AS2();vec2 P=uv*AS;float r=max(uWidth,.003);
  vec2 A=uPreviousMousePos*AS,B=uMousePos*AS,ba=B-A;
  float len=length(ba);
  float h=clamp(dot(P-A,ba)/max(dot(ba,ba),1e-8),0.,1.);
  float dist=length(P-A-ba*h);
  float k=exp(-dist*dist/(r*r));
  float mv=smoothstep(.0015,.02,len)*uActive;
  float e=k*(mv*uStrength*(1.+uSpeedGain*uSpeed)+uDown*uHold*.25*uActive)*FDT();
  vec2 dir=len>1e-5?ba/len:vec2(0.);
  vec3 o=vec3(e,dir*e);
  vec2 q=P-uClick.xy*AS;
  o.x+=exp(-dot(q,q)/(r*r*3.))*uClick.z*uBurst;
  if(uAmbient>.001){
    float t=uClock*uAmbientSpeed,t0=t-.06;
    vec2 a1=vec2(.5+.34*sin(t*.61+1.),.5+.28*sin(t*.83+.3)*cos(t*.37))*AS;
    vec2 a0=vec2(.5+.34*sin(t0*.61+1.),.5+.28*sin(t0*.83+.3)*cos(t0*.37))*AS;
    vec2 ab=a1-a0;float hh=clamp(dot(P-a0,ab)/max(dot(ab,ab),1e-8),0.,1.);
    float dd=length(P-a0-ab*hh);
    float ea=exp(-dd*dd/(r*r))*uAmbient*uStrength*FDT();
    o+=vec3(ea,normalize(ab+1e-6)*ea);
  }
  return o;
}
`;

/* A cleared buffer is all zeros (alpha 0). Engines that store signed values as 0.5 + v read such a texel as "nothing happened yet". */
const EMPTY: Record<FieldEngine, string | null> = { ink: 'vec4(0.,0.,0.,1.)', flow: 'vec4(.5,.5,0.,1.)', wave: null, growth: 'vec4(0.,0.,0.,1.)', age: 'vec4(0.,0.,0.,1.)' };
const tap = (engine: FieldEngine) => EMPTY[engine] ? `vec4 tex(vec2 q){vec4 s=texture(uPingPongTexture,q);return s.a<.5?${EMPTY[engine]}:s;}\n` : `vec4 tex(vec2 q){return texture(uPingPongTexture,q);}\n`;

/* One feedback shader per engine. State is kept in the buffer's four channels. */
const ENGINES: Record<FieldEngine, string> = {
  /* R: ink */
  ink: `${tap('ink')}
void main(){
  vec2 uv=vTextureCoord;vec2 px=1./uResolution;
  vec2 w=vec2(vnoise(uv*uTurbScale*5.+uClock*.25),vnoise(uv*uTurbScale*5.+31.7-uClock*.2))-.5;
  vec2 q=uv-vec2(uDriftX,uDriftY)*uDt/AS2()-w*uTurb*.004;
  vec2 o=px*(1.+uSpread*3.);
  float nb=(tex(q+vec2(o.x,0.)).r+tex(q-vec2(o.x,0.)).r+tex(q+vec2(0.,o.y)).r+tex(q-vec2(0.,o.y)).r)*.25;
  float ink=mix(tex(q).r,nb,uSpread*.9)*pow(uDecay,FDT());
  ink=max(ink-.0008,0.)+brush(uv).x;
  fragColor=vec4(min(ink,6.),0.,0.,1.);
}`,
  /* RG: velocity (±4, stored /8+.5)   B: dye */
  flow: `${tap('flow')}
vec2 dv(vec4 s){return (s.rg-.5)*8.;}
void main(){
  vec2 uv=vTextureCoord;vec2 AS=AS2();vec2 px=1./uResolution;
  vec2 v0=dv(tex(uv));
  vec2 q=uv-v0*uAdvect*uDt/AS;
  vec4 s=tex(q);
  vec2 o=px*(1.+uViscosity*3.);
  vec4 nb=(tex(q+vec2(o.x,0.))+tex(q-vec2(o.x,0.))+tex(q+vec2(0.,o.y))+tex(q-vec2(0.,o.y)))*.25;
  vec2 v=mix(dv(s),dv(nb),uViscosity*.8)*pow(uDecay,FDT());
  float dye=mix(s.b,nb.b,uViscosity*.5)*pow(uDyeDecay,FDT());
  vec3 b=brush(uv);
  v+=(b.yz+vec2(-b.z,b.y)*uSwirl)*uPush*.06;
  dye=min(max(dye-.0006,0.)+b.x*.5,3.);
  fragColor=vec4(clamp(v,-4.,4.)/8.+.5,dye,1.);
}`,
  /* R: height above 0   G: height below 0   B: upward velocity   A: downward velocity (each clamped to ±2) */
  wave: `${tap('wave')}
float dh(vec2 q){vec4 s=tex(q);return s.r-s.g;}
void main(){
  vec2 uv=vTextureCoord;vec2 px=1./uResolution;
  vec4 s=tex(uv);
  float h=s.r-s.g,vel=s.b-s.a;
  float sum=dh(uv+vec2(px.x,0.))+dh(uv-vec2(px.x,0.))+dh(uv+vec2(0.,px.y))+dh(uv-vec2(0.,px.y));
  vel+=uWaveSpeed*(sum-4.*h);
  vel*=pow(uDamping,FDT()*.5);
  vec3 b=brush(uv);
  vel-=b.x*uPush*.012;
  vel-=h*.004;
  h=clamp(h+vel,-2.,2.);vel=clamp(vel,-2.,2.);
  fragColor=vec4(max(h,0.),max(-h,0.),max(vel,0.),max(-vel,0.));
}`,
  /* R: 1 − A   G: B   (Gray–Scott; a cleared buffer is the empty "A = 1" state) */
  growth: `${tap('growth')}
vec2 ab(vec2 q){vec4 s=tex(q);return vec2(1.-s.r,s.g);}
void main(){
  vec2 uv=vTextureCoord;vec2 px=1./uResolution;
  vec2 c=ab(uv);
  vec2 lap=-c+(ab(uv+vec2(px.x,0.))+ab(uv-vec2(px.x,0.))+ab(uv+vec2(0.,px.y))+ab(uv-vec2(0.,px.y)))*.2
    +(ab(uv+px)+ab(uv-px)+ab(uv+vec2(px.x,-px.y))+ab(uv+vec2(-px.x,px.y)))*.05;
  float reaction=c.x*c.y*c.y;
  float A=c.x+(1.*lap.x-reaction+uFeed*(1.-c.x))*uRate;
  float B=c.y+(uDiffB*lap.y+reaction-(uKill+uFeed)*c.y)*uRate;
  float sd=brush(uv).x*uSeed;
  B+=sd*.5;A-=sd*.4;
  fragColor=vec4(1.-clamp(A,0.,1.),clamp(B,0.,1.),0.,1.);
}`,
  /* R: energy (fast fade)   G: scar (slow fade) */
  age: `${tap('age')}
void main(){
  vec2 uv=vTextureCoord;vec2 px=1./uResolution;
  vec2 w=vec2(vnoise(uv*uTurbScale*5.+uClock*.25),vnoise(uv*uTurbScale*5.+31.7-uClock*.2))-.5;
  vec2 q=uv-vec2(uDriftX,uDriftY)*uDt/AS2()-w*uTurb*.004;
  vec2 o=px*(1.+uSpread*3.);
  vec4 s=tex(q);
  vec2 nb=(tex(q+vec2(o.x,0.)).rg+tex(q-vec2(o.x,0.)).rg+tex(q+vec2(0.,o.y)).rg+tex(q-vec2(0.,o.y)).rg)*.25;
  vec2 f=mix(s.rg,nb,uSpread*.9);
  float add=clamp(brush(uv).x,0.,1.);
  float e=max(f.r*pow(uDecay,FDT())-.0006,add);
  float scar=max(f.g*pow(mix(.97,.99995,uScar),FDT()),e*.9);
  fragColor=vec4(e,scar,0.,1.);
}`,
};

/** how the generator's layer meets the picture, then the shared finishing (glow, saturation, contrast, grain, vignette) */
const COMPOSE = `
vec4 compose(vec2 uv,vec2 warp,vec4 L){
  vec4 B=vec4(0.);
  if(uHasInput>.5){
    if(uSplit>.001&&dot(warp,warp)>1e-12){
      float r=texture(uTexture,uv+warp*(1.+uSplit)).r,b=texture(uTexture,uv+warp*(1.-uSplit)).b;
      vec4 c=texture(uTexture,uv+warp);B=vec4(r,c.g,b,c.a);
    } else B=texture(uTexture,uv+warp);
  }
  L.rgb*=uBright;
  int m=int(uMode+.5);
  if(uHasInput<.5&&m==2) m=0;
  vec4 R;
  if(m==1) R=vec4(B.rgb+L.rgb,max(B.a,L.a));
  else if(m==2){vec3 tint=L.a>.001?L.rgb/L.a:vec3(1.);R=vec4(B.rgb*mix(vec3(1.),tint*1.4,clamp(L.a,0.,1.)),B.a);}
  else R=L+B*(1.-clamp(L.a,0.,1.));
  float a=min(R.a,1.);
  vec3 u=a>.001?R.rgb/a:R.rgb;
  float l=dot(u,vec3(.299,.587,.114));
  u+=max(u-.6,0.)*uGlow*1.5;
  u=mix(vec3(l),u,uSaturation);
  u=max((u-.5)*uContrast+.5,0.);
  u+=(hash21(gl_FragCoord.xy+fract(uClock)*91.)-.5)*uGrain*.25*(.4+l);
  vec2 q=uv-.5;
  u*=clamp(1.-uVignette*dot(q,q)*2.4,0.,1.);
  return mix(B,vec4(max(u,0.)*a,a),clamp(uOpacity,0.,1.));
}
void main(){
  vec2 uv=vTextureCoord;vec4 L=vec4(0.);vec2 warp=vec2(0.);
  gen(uv,L,warp);
  fragColor=compose(uv,warp,L);
}
`;

const field = (engine: FieldEngine) => `
vec4 fld(vec2 uv){vec4 s=texture(uPingPongTexture,uv);${EMPTY[engine] ? `return s.a<.5?${EMPTY[engine]}:s;` : 'return s;'}}
float inkI(vec2 uv){return 1.-exp(-max(fld(uv).r,0.)*uGain);}
vec2 inkGrad(vec2 uv){vec2 e=1.5/uResolution;return vec2(inkI(uv+vec2(e.x,0.))-inkI(uv-vec2(e.x,0.)),inkI(uv+vec2(0.,e.y))-inkI(uv-vec2(0.,e.y)));}
vec2 fvel(vec2 uv){return (fld(uv).rg-.5)*8.;}
float fdye(vec2 uv){return 1.-exp(-fld(uv).b*uGain);}
float wh(vec2 uv){vec4 s=fld(uv);return s.r-s.g;}
vec3 wnorm(vec2 uv,float relief){vec2 e=1.2/uResolution;float dx=wh(uv+vec2(e.x,0.))-wh(uv-vec2(e.x,0.));float dy=wh(uv+vec2(0.,e.y))-wh(uv-vec2(0.,e.y));return normalize(vec3(-dx*relief,-dy*relief,1.));}
vec3 pal(float t){t+=uShift+uCycle*uClock*.1;t=1.-abs(fract(t*.5)*2.-1.);return palAt(t);}
`;

/** one float uniform per control (the palette's own `uStepped` is declared by the palette chunk) */
export const uniformsFor = (keys: string[]): string =>
  [...new Set(keys)].filter(key => key !== 'stepped').map(key => `uniform float u${cap(key)};`).join('\n') + '\n';

export function buildFieldSources(spec: FieldSpec): { frag: string[]; trail: string; steps?: number } {
  const keys = spec.params.map(param => param.key);
  const uniforms = uniformsFor(keys);
  return {
    frag: [`${HEAD}${uniforms}${PALETTE}${NOISE}${field(spec.engine)}${spec.gen}${COMPOSE}`],
    trail: `${HEAD}${uniforms}${NOISE}${BRUSH}${ENGINES[spec.engine]}`,
    ...(spec.engine === 'wave' ? { steps: 4 } : spec.engine === 'growth' ? { steps: 10 } : {}),
  };
}

export { HEAD, NOISE };
