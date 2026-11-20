import { defineField, p } from './spec';

/* Wave engine: a genuine wave equation. Growth engine: Gray–Scott reaction–diffusion. Age engine: fresh energy plus a lasting scar. */

export const WAVE_SPECS = [
  defineField({
    id: 'water', label: 'Water ripples', icon: '◌', family: 'Water', engine: 'wave',
    blurb: 'A simulated water surface: refraction, specular glints and a tinted body. Ripples travel, reflect off the edges and interfere.',
    look: { scale: 1, gain: 1, anim: 1, extra: [p('relief', 'Surface relief', 0.5, 80, 36, 0.5), p('refract', 'Refraction', 0, 4, 2), p('shine', 'Glint sharpness', 8, 240, 80, 1), p('spec', 'Glint strength', 0, 2, 0.9), p('body', 'Water body', 0, 1, 0.4), p('wash', 'Depth tint', 0, 4, 1.2)] },
    ptr: { width: 0.04, burst: 1.2 }, mem: { waveSpeed: 0.4, damping: 0.985, push: 1.2 }, ren: { split: 0.2 },
    colors: ['#021a2e', '#0b6fa4', '#4cc9f0', '#e0fbff'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  float h=wh(uv);vec3 n=wnorm(uv,uRelief);
  warp=-n.xy*uRefract*.05;
  vec3 lv=normalize(vec3(.35,.55,.75));
  float sp=pow(max(dot(n,normalize(lv+vec3(0.,0.,1.))),0.),uShine)*uSpec;
  float ta=clamp(uBody+abs(h)*uWash,0.,1.);
  L=vec4(pal(.25+h*.5)*ta+vec3(sp),clamp(ta+sp,0.,1.));
}`,
    preset: { label: 'Water ripples', description: 'Real ripples that spread from the pointer and bounce off the edges.', opacity: 1 },
  }),
  defineField({
    id: 'caustics', label: 'Caustic light', icon: '❈', family: 'Water', engine: 'wave',
    blurb: 'Pool-floor light: the focused net of bright lines that a rippling surface throws on the ground.',
    look: { scale: 1, gain: 1, anim: 1, extra: [p('focus', 'Focus', 0, 3, 1), p('sharp', 'Line sharpness', 0.5, 4, 1.6), p('base', 'Ambient caustics', 0, 1, 0.35), p('refract', 'Refraction', 0, 2, 0.5)] },
    ptr: { width: 0.045, burst: 1 }, mem: { waveSpeed: 0.4, damping: 0.988, push: 1.2 }, fin: { glow: 0.5 },
    colors: ['#01121f', '#0a5a8a', '#3fd0ff', '#f2fdff'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  vec2 e=2./uResolution;float h=wh(uv);
  float lap=wh(uv+vec2(e.x,0.))+wh(uv-vec2(e.x,0.))+wh(uv+vec2(0.,e.y))+wh(uv-vec2(0.,e.y))-4.*h;
  float c=pow(max(1.+lap*uFocus*170.,0.),uSharp);
  vec2 p=uv*AS2()*uScale*6.;float t=uClock*uAnim*.4;
  float base=pow(abs(sin(p.x+sin(p.y*1.3+t)*1.5)*sin(p.y+sin(p.x*1.1-t)*1.5)),.5)*uBase;
  warp=-wnorm(uv,36.).xy*uRefract*.03;
  float a=clamp(c*.5+base*.4-.15,0.,1.);
  L=vec4(pal(clamp(c*.35+base*.2,0.,1.))*a*1.4,a);
}`,
    preset: { label: 'Caustic light', description: 'Shimmering pool-floor light that ripples where the pointer touches.', opacity: 1 },
  }),
  defineField({
    id: 'liquidmetal', label: 'Liquid chrome', icon: '◉', family: 'Water', engine: 'wave',
    blurb: 'A mercury surface that reflects a sky-and-ground environment, with a sun hot-spot, rippling under the pointer.',
    look: { scale: 1, gain: 1.2, anim: 1, extra: [p('relief', 'Surface relief', 1, 100, 14, 0.5), p('horizon', 'Horizon softness', 0.05, 1, 0.35), p('sun', 'Sun sharpness', 8, 200, 60, 1), p('sunAmt', 'Sun strength', 0, 3, 1.2), p('base', 'Always visible', 0, 1, 0.25)] },
    ptr: { width: 0.05, burst: 1 }, mem: { waveSpeed: 0.4, damping: 0.99, push: 1.3 },
    colors: ['#050510', '#3a4a7a', '#b8c7e8', '#ffffff'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  warp=vec2(0.);
  vec3 n=wnorm(uv,uRelief);
  vec3 r=reflect(vec3(0.,0.,-1.),n);
  float y=r.y*.5+.5;
  float hor=smoothstep(.5-uHorizon*.2,.5+uHorizon*.2+.001,y);
  vec3 env=mix(pal(.05+y*.2)*.4,pal(.65+y*.35),hor);
  env+=pow(max(dot(r,normalize(vec3(.3,.6,.7))),0.),uSun)*uSunAmt;
  float a=clamp(uBase+abs(wh(uv))*uGain*2.+length(n.xy)*3.,0.,1.);
  L=vec4(env*a,a);
}`,
    preset: { label: 'Liquid chrome', description: 'A mirror-silver liquid surface that ripples and flashes.', opacity: 1 },
  }),
  defineField({
    id: 'sonar', label: 'Sonar pulse', icon: '◎', family: 'Water', engine: 'wave',
    blurb: 'Draws the wave field as glowing contour rings over a faint radar grid. Positive and negative crests take different colours.',
    look: { scale: 1, gain: 1.6, anim: 1, extra: [p('levels', 'Rings', 2, 40, 10, 1), p('line', 'Ring weight', 0.05, 1, 0.35), p('grid', 'Radar grid', 0, 1, 0.4), p('gridN', 'Grid size', 6, 60, 24, 1), p('halo', 'Halo', 0, 1, 0.3)] },
    ptr: { width: 0.035, burst: 1.5 }, mem: { waveSpeed: 0.42, damping: 0.99, push: 1.3 }, fin: { glow: 0.7 },
    colors: ['#021208', '#00a35a', '#2bff88', '#e9ffe9'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  warp=vec2(0.);
  float h=wh(uv)*uGain;float s=abs(h);
  float f=fract(s*uLevels);float dd=min(f,1.-f);
  float ring=(1.-smoothstep(0.,uLine*.5,dd))*smoothstep(.01,.05,s);
  vec2 g=uv*AS2()*uGridN;vec2 gf=fract(g);
  float grid=(1.-smoothstep(0.,.04,min(min(gf.x,1.-gf.x),min(gf.y,1.-gf.y))))*uGrid*.25;
  float halo=smoothstep(0.,.3,s)*uHalo*.5;
  float a=clamp(ring+grid+halo,0.,1.);
  vec3 c=pal(.5+.5*sign(h)*min(s*3.,1.))+ring*ring*.5;
  L=vec4(c*a,a);
}`,
    preset: { label: 'Sonar pulse', description: 'Green radar rings that expand from every touch over a faint grid.', opacity: 1 },
  }),
];

export const GROWTH_SPECS = [
  defineField({
    id: 'coral', label: 'Coral growth', icon: '❦', family: 'Growth', engine: 'growth',
    blurb: 'Reaction–diffusion: the pointer plants a seed and a labyrinth of coral grows from it by itself, lit like a relief.',
    look: { scale: 1, gain: 1, anim: 1, extra: [p('thresh', 'Threshold', 0.02, 0.5, 0.18), p('soft', 'Edge softness', 0.005, 0.2, 0.04), p('relief', 'Relief', 0, 4, 1.5), p('range', 'Colour range', 0.1, 2, 0.7), p('light', 'Light direction', 0, 360, 45, 1, '°'), p('outline', 'Outline', 0, 1, 0.4)] },
    ptr: { width: 0.03, burst: 1.5 }, mem: { seed: 1.4, feed: 0.055, kill: 0.062, diffB: 0.5, rate: 1 },
    colors: ['#0a0220', '#6d28d9', '#f472b6', '#fde68a'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  warp=vec2(0.);
  vec4 s=fld(uv);float B=s.g;vec2 e=1.2/uResolution;
  float bx=fld(uv+vec2(e.x,0.)).g-fld(uv-vec2(e.x,0.)).g;
  float by=fld(uv+vec2(0.,e.y)).g-fld(uv-vec2(0.,e.y)).g;
  vec3 n=normalize(vec3(-bx*uRelief*6.,-by*uRelief*6.,1.));
  float m=smoothstep(uThresh-uSoft,uThresh+uSoft,B);
  float lr=uLight*.01745;
  float diff=max(dot(n,normalize(vec3(cos(lr),sin(lr),.8))),0.);
  vec3 c=pal(uRange*B*3.+s.r*.3)*(.35+.65*diff)+pow(diff,12.)*.25;
  float rimM=smoothstep(uThresh-uSoft*3.,uThresh,B)*(1.-m)*uOutline;
  c=mix(c,pal(1.),rimM);
  float a=clamp(m+rimM,0.,1.);
  L=vec4(c*a,a);
}`,
    preset: { label: 'Coral growth', description: 'Pink coral that grows into a maze from wherever you touch.', opacity: 1 },
  }),
  defineField({
    id: 'turing', label: 'Turing skin', icon: '⁙', family: 'Growth', engine: 'growth',
    blurb: 'The same chemistry tuned for stripes and mazes: a two-tone animal skin with pores and an inner shadow that spreads from wherever you touch.',
    look: { scale: 1, gain: 1, anim: 1, extra: [p('thresh', 'Threshold', 0.02, 0.5, 0.15), p('soft', 'Edge softness', 0.005, 0.2, 0.05), p('bump', 'Skin bump', 0, 4, 1.2), p('pore', 'Pore texture', 0, 1, 0.4), p('base', 'Resting skin', 0, 1, 0.2)] },
    ptr: { width: 0.06, burst: 2 }, mem: { seed: 2.4, feed: 0.030, kill: 0.0575, diffB: 0.5, rate: 1 },
    colors: ['#f2d3a6', '#c98b4b', '#3b1f0e', '#1a0c05'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  warp=vec2(0.);
  float B=fld(uv).g;vec2 e=1.2/uResolution;
  float bx=fld(uv+vec2(e.x,0.)).g-fld(uv-vec2(e.x,0.)).g;
  float by=fld(uv+vec2(0.,e.y)).g-fld(uv-vec2(0.,e.y)).g;
  vec3 n=normalize(vec3(-bx*uBump*6.,-by*uBump*6.,1.));
  float t=smoothstep(uThresh-uSoft,uThresh+uSoft,B);
  float pores=vnoise(uv*AS2()*uPore*80.+1.)*.5+vnoise(uv*AS2()*uPore*160.)*.5;
  vec3 c=mix(pal(.1),pal(.9),t);
  c*=1.-uPore*(pores-.5)*.5;
  c*=.75+.25*dot(n,normalize(vec3(.4,.5,.8)));
  float a=clamp(uBase+smoothstep(0.,.08,B),0.,1.);
  L=vec4(c*a,a);
}`,
    preset: { label: 'Turing skin', description: 'Zebra-and-maze stripes that grow across a two-tone skin from wherever you touch.', opacity: 1 },
  }),
];

export const AGE_SPECS = [
  defineField({
    id: 'shatter', label: 'Shattered glass', icon: '◇', family: 'Shatter & burn', engine: 'age',
    blurb: 'Voronoi shards that light up and shift apart where the pointer has been, leaving bright cracks that slowly heal.',
    look: { scale: 1, gain: 1, anim: 1, extra: [p('cells', 'Shard count', 3, 40, 12, 0.5), p('warp', 'Crack waviness', 0, 3, 1), p('edge', 'Crack width', 0.02, 0.4, 0.1), p('push', 'Shard displacement', 0, 4, 1.2), p('gap', 'Lasting displacement', 0, 1, 0.6), p('wash', 'Shard tint', 0, 1, 0.5), p('flicker', 'Flicker', 0, 3, 0.8)] },
    ptr: { width: 0.1 }, mem: { decay: 0.96, scar: 0.8, spread: 0.1 }, ren: { split: 0.5 },
    colors: ['#0b1020', '#38bdf8', '#a78bfa', '#ffffff'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  vec2 AS=AS2();
  vec2 p=uv*AS*uCells;
  p+=(fbm(p*.3)-.5)*uWarp;
  vec4 v=voronoi(p);
  vec2 cuv=v.zw/uCells/AS;
  vec4 F=fld(cuv);float E=F.r,S=F.g;
  float edge=1.-smoothstep(0.,uEdge,v.x);
  vec2 cid=floor(v.zw*7.);
  float id=hash21(cid);
  warp=(hash22(cid)-.5)*2.*(E*uPush*.05+S*uPush*.02*uGap);
  float fl=.6+.4*sin(uClock*uFlicker*6.+id*6.28);
  float a=clamp(E*uWash*.6*fl+edge*(S+E)*.9+S*.12,0.,1.);
  L=vec4(mix(pal(id*.5+E*.5),pal(1.),edge)*a,a);
}`,
    preset: { label: 'Shattered glass', description: 'Glass shards that tilt and glow where you touch, with cracks that linger.', opacity: 1 },
  }),
  defineField({
    id: 'burn', label: 'Paper burn', icon: '🔥', family: 'Shatter & burn', engine: 'age',
    blurb: 'A veil that burns away under the pointer: glowing ember edge, charred scar, heat shimmer, and the picture revealed beneath.',
    look: { scale: 1, gain: 1, anim: 1, extra: [p('rough', 'Edge roughness', 1, 14, 4, 0.5), p('reach', 'Burn reach', 0.5, 4, 1.6), p('edge', 'Ember width', 0.02, 0.4, 0.12), p('ember', 'Ember glow', 0, 3, 1.3), p('veil', 'Veil opacity', 0, 1, 0.9), p('char', 'Char', 0, 1, 0.5)] },
    ptr: { width: 0.09, hold: 1 }, mem: { decay: 0.97, scar: 1, spread: 0.2 },
    colors: ['#241608', '#7a1d00', '#ff6a00', '#ffd36b'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  vec4 F=fld(uv);float E=F.r,S=F.g;
  vec2 p=uv*AS2()*uRough;
  float n=fbm(p+vec2(0.,uClock*uAnim*.05))*.7+fbm(p*3.)*.3;
  float dd=(E+S*.9)*uReach*.6-n*.5;
  float burnt=smoothstep(0.,.02,dd);
  float ember=smoothstep(-uEdge,0.,dd)*(1.-smoothstep(0.,uEdge,dd));
  float veilA=(1.-burnt)*uVeil;
  float charA=S*burnt*uChar*(1.-E);
  warp=vec2(sin(uv.y*60.+uClock*3.),cos(uv.x*60.+uClock*2.7))*ember*.003;
  vec3 col=pal(.05)*veilA+pal(.55+ember*.45)*ember*uEmber*2.;
  float a=clamp(veilA+ember*.8+charA*.6,0.,1.);
  L=vec4(col,a);
}`,
    preset: { label: 'Paper burn', description: 'A dark veil that burns away to reveal the picture, with glowing embers on the edge.', opacity: 1 },
  }),
];
