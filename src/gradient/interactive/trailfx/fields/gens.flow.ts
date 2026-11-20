import { defineField, opt, p } from './spec';

const FAMILY = 'Fluid';

/* Flow engine: a velocity field with dye. The pointer stirs it; it carries itself along (self-advection) and slowly settles. */
export const FLOW_SPECS = [
  defineField({
    id: 'marble', label: 'Liquid marble', icon: '◔', family: FAMILY, engine: 'flow',
    blurb: 'Marbled stripes that smear and fold as the pointer stirs them, like paint dragged through water.',
    look: { scale: 1, gain: 1.4, anim: 0.6, extra: [p('bands', 'Stripes', 0.5, 8, 2.5, 0.1), p('angle', 'Stripe angle', -90, 90, 30, 1, '°'), p('stretch', 'Smear', 0, 4, 1.5), p('turb', 'Marbling', 0, 2, 0.6), p('fill', 'Always visible', 0, 1, 0.35)] },
    ptr: { width: 0.1 }, mem: { push: 1.2, viscosity: 0.3 }, fin: { glow: 0.2 },
    colors: ['#0b1020', '#1d4ed8', '#e0f2fe', '#f59e0b', '#7c2d12'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  warp=vec2(0.);
  vec2 v=fvel(uv);float dye=fdye(uv);
  vec2 q=uv*AS2()-v*uStretch*.3;
  float ang=uAngle*.01745;
  float s=dot(q,vec2(cos(ang),sin(ang)))*uBands*3.+(fbm(q*uScale*2.+uClock*uAnim*.05)-.5)*uTurb*6.;
  float stripe=.5+.5*sin(s*6.2831);
  vec3 c=pal(stripe*.9+length(v)*.2);
  float a=clamp(uFill+dye*1.2+length(v)*.8,0.,1.);
  L=vec4(c*a,a);
}`,
    preset: { label: 'Liquid marble', description: 'Blue-and-gold marbling that you stir with the pointer.', opacity: 1 },
  }),
  defineField({
    id: 'ferro', label: 'Ferrofluid', icon: '▲', family: FAMILY, engine: 'flow',
    blurb: 'A black magnetic liquid that bristles into glossy spikes wherever the pointer moves.',
    look: { scale: 1, gain: 1.6, anim: 0.5, extra: [p('spikes', 'Spike count', 6, 60, 24, 1), p('height', 'Spike height', 0, 2, 1), p('sharp', 'Spike sharpness', 0.5, 4, 1.5), p('shine', 'Shine', 4, 120, 40, 1), p('spec', 'Highlight', 0, 2, 1), p('rim', 'Rim light', 0, 1, 0.4), p('base', 'Resting sheen', 0, 1, 0.3)] },
    ptr: { width: 0.11 }, mem: { push: 1.4, viscosity: 0.4, decay: 0.975 },
    colors: ['#05060a', '#1a2540', '#5b7cff', '#e8f0ff'], gen: `
float hf(vec2 uv){
  float m=length(fvel(uv))*.5+fdye(uv);
  vec4 v=voronoi(uv*AS2()*uSpikes+vec2(0.,uClock*uAnim*.05));
  float cone=1.-smoothstep(0.,.75,v.y);
  return clamp(m*uGain*.5,0.,1.)*pow(cone,uSharp)*uHeight;
}
void gen(vec2 uv,out vec4 L,out vec2 warp){
  warp=vec2(0.);
  float m=length(fvel(uv))*.5+fdye(uv);
  vec2 e=1.5/uResolution;
  float h=hf(uv);
  float dx=hf(uv+vec2(e.x,0.))-hf(uv-vec2(e.x,0.));
  float dy=hf(uv+vec2(0.,e.y))-hf(uv-vec2(0.,e.y));
  vec3 n=normalize(vec3(-dx*40.,-dy*40.,1.));
  vec3 lv=normalize(vec3(.4,.6,.7));
  float diff=max(dot(n,lv),0.);
  float sp=pow(max(dot(reflect(-lv,n),vec3(0.,0.,1.)),0.),uShine);
  vec3 c=pal(.15+h*.4)*(.12+.5*diff)+pal(.85)*sp*uSpec+pal(.6)*pow(1.-n.z,2.)*uRim;
  float a=clamp(uBase+smoothstep(0.,.05,m)*.9,0.,1.);
  L=vec4(c*a,a);
}`,
    preset: { label: 'Ferrofluid', description: 'Glossy black spikes rise out of a dark pool under the pointer.', opacity: 1 },
  }),
  defineField({
    id: 'fieldlines', label: 'Magnetic field lines', icon: '⌇', family: FAMILY, engine: 'flow',
    blurb: 'Line-integral convolution: fine streamlines that trace the direction of the flow, coloured by angle or speed.',
    look: { scale: 1, gain: 1.4, anim: 1, extra: [p('steps', 'Line quality', 4, 16, 10, 1), p('length', 'Line length', 0.004, 0.06, 0.02, 0.001), p('density', 'Line density', 40, 600, 220, 5), p('lines', 'Line contrast', 0.5, 4, 2), opt('colorBy', 'Colour by', ['Direction', 'Speed'], 0)] },
    ptr: { width: 0.12 }, mem: { push: 1.3, decay: 0.985, dyeDecay: 0.985 },
    colors: ['#0a1020', '#22d3ee', '#a78bfa', '#f472b6'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  warp=vec2(0.);
  vec2 AS=AS2();
  float acc=0.,ws=0.;
  for(int dir=0;dir<2;dir++){
    vec2 q=uv;float sgn=dir==0?1.:-1.;
    for(int i=0;i<16;i++){
      if(float(i)>=uSteps) break;
      vec2 v=fvel(q);
      if(length(v)<.0005) break;
      q+=sgn*normalize(v)*uLength/AS;
      float w=1.-float(i)/uSteps;
      acc+=w*hash21(floor(q*AS*uDensity));ws+=w;
    }
  }
  float n=ws>0.?acc/ws:.5;
  vec2 v0=fvel(uv);
  float mask=clamp(length(v0)*uGain*.8+fdye(uv)*.6,0.,1.);
  float l=clamp((n-.5)*uLines*4.+.5,0.,1.);
  float t=uColorBy>.5?clamp(length(v0)*.5,0.,1.):atan(v0.y,v0.x)*.159+.5;
  float a=mask*l;
  L=vec4(pal(t)*a,a);
}`,
    preset: { label: 'Magnetic field lines', description: 'Hair-fine streamlines that bend around the pointer like iron filings.', opacity: 1 },
  }),
  defineField({
    id: 'silk', label: 'Silk folds', icon: '〰', family: FAMILY, engine: 'flow',
    blurb: 'Satin fabric whose folds stretch along the flow, lit with an anisotropic sheen.',
    look: { scale: 1, gain: 1.4, anim: 0.6, extra: [p('folds', 'Fold depth', 0.3, 3, 1.2), p('stretch', 'Stretch with flow', 0, 8, 3), p('relief', 'Relief', 0.2, 4, 1.5), p('shine', 'Shine', 4, 100, 30, 1), p('sheen', 'Sheen', 0, 2, 0.9), p('fill', 'Always visible', 0, 1, 0.4)] },
    ptr: { width: 0.13 }, mem: { push: 1.2, viscosity: 0.45, decay: 0.98 },
    colors: ['#2a0a2e', '#8e2de2', '#f06292', '#ffe0ec'], gen: `
float silkH(vec2 uv){
  vec2 v=fvel(uv);float m=length(v);
  vec2 dd=m>.001?v/m:vec2(1.,0.);
  vec2 p=uv*AS2()*uScale*3.;
  vec2 pp=vec2(dot(p,dd),dot(p,vec2(-dd.y,dd.x)));
  pp.x/=1.+m*uStretch;
  return fbm(pp*vec2(1.,2.)+uClock*uAnim*.03)*uFolds+fdye(uv)*.5;
}
void gen(vec2 uv,out vec4 L,out vec2 warp){
  warp=vec2(0.);
  vec2 e=1.5/uResolution;
  float h=silkH(uv);
  float dx=silkH(uv+vec2(e.x,0.))-silkH(uv-vec2(e.x,0.));
  float dy=silkH(uv+vec2(0.,e.y))-silkH(uv-vec2(0.,e.y));
  vec3 n=normalize(vec3(-dx*uRelief*30.,-dy*uRelief*30.,1.));
  vec3 lv=normalize(vec3(.5,.6,.6));
  float diff=max(dot(n,lv),0.);
  float an=pow(max(dot(n,normalize(lv+vec3(0.,0.,1.))),0.),uShine);
  vec3 c=pal(h*.6)*(.3+.7*diff)+pal(.95)*an*uSheen;
  float a=clamp(uFill+fdye(uv)+length(fvel(uv))*.5,0.,1.);
  L=vec4(c*a,a);
}`,
    preset: { label: 'Silk folds', description: 'Plum satin that ripples and catches the light as you drag across it.', opacity: 1 },
  }),
  defineField({
    id: 'vortex', label: 'Vortex swirl', icon: '꩜', family: FAMILY, engine: 'flow',
    blurb: 'Twists and pushes the picture along the flow, with a glowing rim where the current is strongest.',
    look: { scale: 1, gain: 1.4, anim: 1, extra: [p('bend', 'Twist', 0, 3, 1), p('shove', 'Push', 0, 3, 0.6), p('wash', 'Rim glow', 0, 1, 0.5)] },
    ptr: { width: 0.12 }, mem: { push: 1.5, swirl: 0.8, viscosity: 0.25, decay: 0.985 }, ren: { split: 0.4 },
    colors: ['#0b1020', '#22d3ee', '#a78bfa', '#ffffff'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  vec2 v=fvel(uv);float m=length(v);
  warp=(vec2(-v.y,v.x)*uBend-v*uShove)*.18/AS2();
  float rim=smoothstep(0.,.6,m)*(1.-smoothstep(.6,2.,m));
  float a=clamp(rim*uWash*.6+fdye(uv)*.3*uWash,0.,1.);
  L=vec4(pal(.2+m*.3+atan(v.y,v.x)*.159)*a,a);
}`,
    preset: { label: 'Vortex swirl', description: 'The picture spins and streams around the pointer with a glowing rim.', opacity: 1 },
  }),
  defineField({
    id: 'kaleido', label: 'Kaleido flow', icon: '❋', family: FAMILY, engine: 'flow',
    blurb: 'A mirrored kaleidoscope of flowing noise whose pattern is dragged around by the pointer.',
    look: { scale: 1, gain: 1.4, anim: 1, extra: [p('segments', 'Mirror segments', 2, 24, 8, 1), p('zoom', 'Zoom', 0.3, 3, 1), p('spin', 'Spin', -3, 3, 0.5, 0.05), p('twist', 'Twist with distance', 0, 8, 1.5), p('fill', 'Always visible', 0, 1, 0.3)] },
    ptr: { width: 0.12 }, mem: { push: 1.3, viscosity: 0.3 }, fin: { glow: 0.4 },
    colors: ['#12002b', '#ff2bd6', '#00e5ff', '#fff700'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  warp=vec2(0.);
  vec2 v=fvel(uv);float dye=fdye(uv);
  vec2 p=(uv-.5)*AS2();
  float r=length(p);
  float a=atan(p.y,p.x)+uClock*uAnim*uSpin*.1+r*uTwist;
  float seg=6.2831/uSegments;
  a=abs(mod(a,seg)-seg*.5);
  vec2 k=vec2(cos(a),sin(a))*r*uZoom*3.+v*.8;
  float n=fbm(k*uScale*2.+uClock*uAnim*.1);
  float n2=fbm(k*uScale*4.-n);
  float al=clamp(uFill+dye*1.2+length(v)*.6,0.,1.);
  L=vec4(pal(n*.7+n2*.5+r*.3)*al,al);
}`,
    preset: { label: 'Kaleido flow', description: 'A neon kaleidoscope that the pointer swirls and drags.', opacity: 1 },
  }),
];
