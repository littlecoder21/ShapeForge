/* Trail FX v2 shaders (WebGL2 / GLSL ES 3.00), hand-written and readable. They are merged into TRAILFX_SOURCES in
 * shaders.generated.ts, so the standalone export carries them in effect.json exactly like the original passes.
 *
 *   composite  – how a particle / ribbon layer meets the picture before it (paint, add, reveal, lens)
 *   gradmap    – maps the picture's brightness onto a colour ramp (recolours any effect)
 *   fade       – the afterglow step: decays, diffuses and drifts a layer between frames
 *   particle   – instanced quads, one SDF shape per particle (circle, ring, star, heart, glyph…)
 *   ribbon     – a triangle strip with soft edges, glow, dashes and beads
 * Colours are premultiplied everywhere, matching the canvas. */

const PALETTE = `
uniform vec3 uPal[8];
uniform float uPalN;
uniform float uStepped;
vec3 palAt(float t){
  float n=max(uPalN,1.);
  t=clamp(t,0.,1.);
  if(uStepped>.5){ int k=int(min(floor(t*n),n-1.)); return uPal[k]; }
  float x=t*(n-1.);
  int i=int(floor(x));
  int j=min(i+1,int(n)-1);
  float f=x-float(i);
  f=f*f*(3.-2.*f);
  return mix(uPal[i],uPal[j],f);
}`;

export const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vTextureCoord;
uniform sampler2D uTexture;
uniform sampler2D uPingPongTexture;
uniform vec2 uResolution;
uniform float uMode, uLens, uOpacity, uHasInput;
out vec4 fragColor;
void main(){
  vec2 uv=vTextureCoord;
  vec4 L=texture(uPingPongTexture,uv);
  vec4 B=uHasInput>.5?texture(uTexture,uv):vec4(0.);
  int m=int(uMode+.5);
  if(uHasInput<.5&&m>1) m=0;
  vec4 R;
  float la=clamp(L.a,0.,1.);
  if(m==1){
    R=vec4(B.rgb+L.rgb,max(B.a,la));
  } else if(m==2){
    R=B*la+vec4(L.rgb*.25,0.)*la;
  } else if(m==3){
    vec2 px=1./uResolution;
    float r=4.;
    float ax=texture(uPingPongTexture,uv+vec2(px.x*r,0.)).a-texture(uPingPongTexture,uv-vec2(px.x*r,0.)).a;
    float ay=texture(uPingPongTexture,uv+vec2(0.,px.y*r)).a-texture(uPingPongTexture,uv-vec2(0.,px.y*r)).a;
    vec2 off=vec2(ax,ay)*uLens*.05;
    vec4 c;
    c.r=texture(uTexture,uv-off).r;
    c.g=texture(uTexture,uv-off*1.18).g;
    c.b=texture(uTexture,uv-off*1.36).b;
    c.a=texture(uTexture,uv-off*1.18).a;
    R=c+vec4(L.rgb*.35,0.);
  } else {
    R=L+B*(1.-la);
  }
  fragColor=mix(B,R,clamp(uOpacity,0.,1.));
}`;

export const GRADMAP_FRAG = `#version 300 es
precision highp float;
in vec2 vTextureCoord;
uniform sampler2D uTexture;
uniform float uAmount, uBias, uContrast, uInvert;
${PALETTE}
out vec4 fragColor;
void main(){
  vec4 c=texture(uTexture,vTextureCoord);
  vec3 rgb=c.a>.001?c.rgb/c.a:c.rgb;
  float l=dot(rgb,vec3(.299,.587,.114));
  l=clamp((l-.5)*uContrast+.5+uBias,0.,1.);
  if(uInvert>.5) l=1.-l;
  vec3 mapped=palAt(l);
  vec3 o=mix(rgb,mapped,clamp(uAmount,0.,1.));
  fragColor=vec4(o*c.a,c.a);
}`;

export const FADE_FRAG = `#version 300 es
precision highp float;
in vec2 vTextureCoord;
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform vec2 uDrift;
uniform float uDecay, uSpread;
out vec4 fragColor;
void main(){
  vec2 px=1./uResolution;
  vec2 uv=vTextureCoord-uDrift;
  vec4 c=texture(uTexture,uv);
  if(uSpread>.001){
    vec2 o=px*(1.5+uSpread*2.5);
    vec4 s=texture(uTexture,uv+vec2(o.x,0.))+texture(uTexture,uv-vec2(o.x,0.))+texture(uTexture,uv+vec2(0.,o.y))+texture(uTexture,uv-vec2(0.,o.y));
    c=mix(c,s*.25,uSpread*.8);
  }
  fragColor=max(c*uDecay-vec4(.0015),vec4(0.));
}`;

export const PARTICLE_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec4 aA; // x, y (CSS px), radius (px), rotation
layout(location=1) in vec4 aB; // colour t, alpha, stretch, shape (+ glyph index / 32)
uniform vec2 uView;
out vec2 vP;
out vec4 vB;
void main(){
  vec2 c=vec2(float(gl_VertexID&1),float(gl_VertexID>>1))*2.-1.;
  float s=aA.z*1.8;
  vec2 local=vec2(c.x*s*aB.z,c.y*s);
  float cs=cos(aA.w),sn=sin(aA.w);
  vec2 w=aA.xy+vec2(local.x*cs-local.y*sn,local.x*sn+local.y*cs);
  gl_Position=vec4(w.x/uView.x*2.-1.,1.-w.y/uView.y*2.,0.,1.);
  vP=c*1.8;
  vB=aB;
}`;

export const PARTICLE_FRAG = `#version 300 es
precision highp float;
in vec2 vP;
in vec4 vB;
uniform sampler2D uGlyph;
uniform float uSoft, uOutline, uCore, uBright, uGlyphTint, uGlyphN;
${PALETTE}
out vec4 fragColor;
float dot2(vec2 v){return dot(v,v);}
float sdBox(vec2 p,vec2 b){vec2 d=abs(p)-b;return length(max(d,0.))+min(max(d.x,d.y),0.);}
float sdTri(vec2 p,float r){const float k=1.7320508;p.x=abs(p.x)-r;p.y=p.y+r/k;if(p.x+k*p.y>0.)p=vec2(p.x-k*p.y,-k*p.x-p.y)/2.;p.x-=clamp(p.x,-2.*r,0.);return -length(p)*sign(p.y);}
float sdStar5(vec2 p,float r,float rf){const vec2 k1=vec2(.809016994375,-.587785252292);const vec2 k2=vec2(-k1.x,k1.y);p.x=abs(p.x);p-=2.*max(dot(k1,p),0.)*k1;p-=2.*max(dot(k2,p),0.)*k2;p.x=abs(p.x);p.y-=r;vec2 ba=rf*vec2(-k1.y,k1.x)-vec2(0.,1.);float h=clamp(dot(p,ba)/dot(ba,ba),0.,r);return length(p-ba*h)*sign(p.y*ba.x-p.x*ba.y);}
float sdHex(vec2 p,float r){const vec3 k=vec3(-.866025404,.5,.577350269);p=abs(p);p-=2.*min(dot(k.xy,p),0.)*k.xy;p-=vec2(clamp(p.x,-k.z*r,k.z*r),r);return length(p)*sign(p.y);}
float sdHeart(vec2 p){p.x=abs(p.x);if(p.y+p.x>1.)return sqrt(dot2(p-vec2(.25,.75)))-sqrt(2.)/4.;return sqrt(min(dot2(p-vec2(0.,1.)),dot2(p-.5*max(p.x+p.y,0.))))*sign(p.x-p.y);}
float shapeD(int s,vec2 p){
  if(s==1) return abs(length(p)-.74)-.22;
  if(s==2) return sdBox(p,vec2(.72))-.1;
  if(s==3){vec2 q=vec2(p.x+p.y,p.x-p.y)*.70710678;return sdBox(q,vec2(.6))-.05;}
  if(s==4) return sdTri(vec2(p.x,-p.y)*1.15+vec2(0.,.1),.9)/1.15;
  if(s==5) return sdStar5(vec2(p.x,-p.y)*1.02,1.,.48)/1.02;
  if(s==6){vec2 a=abs(p);return (sqrt(a.x)+sqrt(a.y)-1.)*.42;}
  if(s==7) return min(sdBox(p,vec2(.92,.27)),sdBox(p,vec2(.27,.92)))-.02;
  if(s==8) return sdHex(p,.86);
  if(s==9){vec2 h=vec2(p.x,-p.y)*.78+vec2(0.,.52);return sdHeart(h)/.78;}
  if(s==10) return max(length(p)-.96,-(length(p-vec2(.42,.1))-.8));
  return length(p)-1.;
}
void main(){
  vec2 p=vP;
  int s=int(floor(vB.w+.001));
  float a;
  vec3 tint=vec3(1.);
  vec3 col=palAt(vB.x);
  float d;
  if(s==12){
    float gi=floor(fract(vB.w)*32.+.5);
    vec2 g=p*.5+.5;
    float inside=step(0.,g.x)*step(g.x,1.)*step(0.,g.y)*step(g.y,1.);
    vec2 guv=vec2((gi+clamp(g.x,.02,.98))/max(uGlyphN,1.),clamp(g.y,.02,.98));
    vec4 t=texture(uGlyph,guv);
    a=t.a*inside;
    tint=mix(t.rgb,t.rgb*col,uGlyphTint);
    col=tint;
    d=-a;
  } else {
    d=shapeD(s,p);
    if(uOutline>.001){float t=uOutline*.5;d=abs(d+t)-t;}
    float sf=max(fwidth(d),uSoft*.8);
    a=1.-smoothstep(-sf,sf,d);
  }
  col*=uBright;
  float coreMask=smoothstep(0.,-.9,d);
  col=mix(col,vec3(1.),uCore*coreMask*coreMask);
  a*=vB.y;
  fragColor=vec4(col*a,a);
}`;

export const RIBBON_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec4 aP; // x, y (CSS px), side (-1..1 across the strip), along (0 head .. 1 tail)
layout(location=1) in vec4 aQ; // alpha, colour t, distance from the head (px), half width (px)
uniform vec2 uView;
out vec4 vP;
out vec4 vQ;
void main(){
  gl_Position=vec4(aP.x/uView.x*2.-1.,1.-aP.y/uView.y*2.,0.,1.);
  vP=aP;
  vQ=aQ;
}`;

export const RIBBON_FRAG = `#version 300 es
precision highp float;
in vec4 vP;
in vec4 vQ;
uniform float uStyle, uSoft, uGlow, uCore, uBright, uDash, uDashGap, uDashSpeed, uTime, uExt;
${PALETTE}
out vec4 fragColor;
void main(){
  float dd=abs(vP.z)*uExt;
  float soft=max(uSoft,.04);
  int st=int(uStyle+.5);
  float core,halo;
  if(st==3){
    float cyc=max(uDash+uDashGap,2.);
    float sx=mod(vQ.z-uTime*uDashSpeed,cyc)-cyc*.5;
    float r=length(vec2(sx,vP.z*uExt*vQ.w))/max(vQ.w,.5);
    core=1.-smoothstep(1.-soft,1.,r);
    halo=uGlow*exp(-max(r-.35,0.)*max(r-.35,0.)*3.2)*(1.-smoothstep(uExt*.8,uExt,r));
  } else {
    core=1.-smoothstep(1.-soft,1.,dd);
    halo=uGlow*exp(-max(dd-.35,0.)*max(dd-.35,0.)*3.2)*(1.-smoothstep(uExt*.85,uExt,dd));
    if(st==2){
      float cyc=max(uDash+uDashGap,2.);
      float sx=mod(vQ.z-uTime*uDashSpeed,cyc);
      float m=smoothstep(0.,1.5,sx)*(1.-smoothstep(uDash-1.5,uDash,sx));
      core*=m;halo*=m;
    }
  }
  float a=max(core,halo*.65)*vQ.x;
  vec3 col=palAt(vQ.y)*uBright;
  float hot=uCore*(1.-smoothstep(0.,.65,dd));
  col=mix(col,vec3(1.),hot*step(.001,core));
  fragColor=vec4(col*a,a);
}`;

/** Pieces merged into TRAILFX_SOURCES (see shaders.generated.ts). */
export const GENERATOR_KINDS = {
  emitter: { frag: [COMPOSITE_FRAG], gen: 'emitter' },
  ribbon: { frag: [COMPOSITE_FRAG], gen: 'ribbon' },
  gradmap: { frag: [GRADMAP_FRAG] },
} as const;

export const GENERATOR_LIBRARY = {
  fade: FADE_FRAG,
  particle: { vert: PARTICLE_VERT, frag: PARTICLE_FRAG },
  ribbon: { vert: RIBBON_VERT, frag: RIBBON_FRAG },
};
