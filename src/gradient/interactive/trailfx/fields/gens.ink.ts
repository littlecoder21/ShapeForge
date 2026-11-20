import { defineField, opt, p } from './spec';

const FAMILY = 'Ink fields';

/* Ink engine: the pointer deposits a scalar that bleeds, drifts and fades. Each look reads it as a mask, a height or a thickness. */
export const INK_SPECS = [
  defineField({
    id: 'aurora', label: 'Aurora veil', icon: '☄', family: FAMILY, engine: 'ink',
    blurb: 'Hanging curtains of light that swell where the pointer passes. Sway, ray sharpness and reach are all yours.',
    look: { scale: 1, gain: 1.6, anim: 1, extra: [p('bands', 'Curtains', 1, 14, 4, 0.5), p('rays', 'Ray sharpness', 0, 1, 0.3), p('sway', 'Sway', 0, 2, 0.8), p('reach', 'Reach', 0.3, 2.5, 1.2)] },
    ptr: { width: 0.12, ambient: 0.4 }, mem: { decay: 0.965, spread: 0.45, driftY: 0.03 }, fin: { glow: 0.5 },
    colors: ['#0b1f3a', '#1de9b6', '#7c4dff', '#e0fff4'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  warp=vec2(0.);
  float I=inkI(uv);vec2 p=uv*AS2();float t=uClock*uAnim;
  float sway=(fbm(vec2(p.x*uScale*.7,t*.12))-.5)*uSway*2.;
  float x=p.x*uBands+sway;
  float cur=pow(.5+.5*sin(x*6.2831+fbm(vec2(x*2.,t*.2))*3.),1.+uRays*3.);
  float rays=.6+.4*vnoise(vec2(x*9.,t*.5+p.y*2.));
  float v=smoothstep(0.,1.,I*uReach)*(.3+.7*cur)*rays;
  v=max(v,I*.2);
  vec3 c=pal(.08+.6*clamp(v,0.,1.)+uv.y*.2);
  float a=clamp(v*1.15,0.,1.);
  L=vec4(c*a,a);
}`,
    preset: { label: 'Aurora veil', description: 'Curtains of green and violet light that bloom behind the pointer and keep drifting on their own.', p: { ambient: 0.35 }, opacity: 1 },
  }),
  defineField({
    id: 'smoke', label: 'Smoke plume', icon: '♨', family: FAMILY, engine: 'ink',
    blurb: 'Warped fractal smoke that rises from the pointer and curls as it thins out.',
    look: { scale: 1.2, gain: 1.4, anim: 1, extra: [p('rise', 'Rise speed', 0, 2, 0.6), p('curl', 'Curl', 0, 2, 1), p('wisp', 'Wispiness', 0, 1, 0.5)] },
    ptr: { width: 0.07 }, mem: { decay: 0.97, spread: 0.55, driftY: 0.07, turb: 1.2 },
    colors: ['#2a2f3a', '#8a94a8', '#dfe6f2', '#ffffff'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  warp=vec2(0.);
  float I=inkI(uv);vec2 p=uv*AS2()*uScale*2.;float t=uClock*uAnim;
  vec2 q=p+vec2(0.,-t*uRise*.3);
  vec2 w=vec2(fbm(q+vec2(0.,t*.1)),fbm(q+vec2(5.2,1.3)));
  float n=fbm(q+(w-.5)*uCurl*3.);
  float dens=smoothstep(.15,.95,I*(.45+n*1.1));
  dens=pow(dens,mix(1.2,.6,uWisp));
  vec3 c=pal(n*.7+I*.3);
  L=vec4(c*dens,dens);
}`,
    preset: { label: 'Smoke plume', description: 'Soft grey smoke that rises and curls off the pointer.', opacity: 1 },
  }),
  defineField({
    id: 'plasma', label: 'Plasma bloom', icon: '❂', family: FAMILY, engine: 'ink',
    blurb: 'Interfering sine waves in your palette, revealed wherever the pointer has been.',
    look: { scale: 1, gain: 1.5, anim: 1, extra: [p('freqA', 'Wave frequency A', 0.5, 8, 3, 0.1), p('freqB', 'Wave frequency B', 0.5, 8, 4, 0.1), p('twist', 'Twist', 0, 2, 0.5), p('bleed', 'Edge softness', 0.05, 1, 0.4)] },
    ptr: { width: 0.13 }, mem: { decay: 0.955, spread: 0.5 }, fin: { glow: 0.6 },
    colors: ['#12002b', '#ff2bd6', '#00e5ff', '#fff700'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  warp=vec2(0.);
  float I=inkI(uv);vec2 p=uv*AS2()*uScale*3.;float t=uClock*uAnim*.6;
  float v=sin(p.x*uFreqA+t)+sin(p.y*uFreqB-t*1.3)+sin((p.x+p.y)*.5*uFreqA+t*.7)+sin(length(p-vec2(1.5,1.))*uFreqB*.8-t);
  v+=uTwist*sin(atan(p.y-1.,p.x-1.5)*3.+t);
  v=v*.25+.5;
  float a=smoothstep(0.,uBleed,I)*(.35+.65*I);
  L=vec4(pal(v)*a,a);
}`,
    preset: { label: 'Plasma bloom', description: 'Hot magenta-cyan plasma that blooms under the pointer.', opacity: 1 },
  }),
  defineField({
    id: 'heat', label: 'Heat haze', icon: '≈', family: FAMILY, engine: 'ink',
    blurb: 'Bends and shimmers the picture where the pointer is hot, with a coloured glow and optional colour fringing.',
    look: { scale: 1, gain: 1.4, anim: 1, extra: [p('bend', 'Shimmer amount', 0, 0.15, 0.06, 0.001), p('lens', 'Lens from the edges', 0, 6, 2.5), p('wash', 'Heat tint', 0, 1, 0.5)] },
    ptr: { width: 0.11 }, mem: { decay: 0.95, spread: 0.6, driftY: 0.05, turb: 0.8 }, ren: { mode: 0, split: 0.5 },
    colors: ['#3b0a00', '#ff4a00', '#ffb000', '#fff3b0'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  float I=inkI(uv);float t=uClock*uAnim;
  vec2 p=uv*AS2()*uScale*6.;
  vec2 n=vec2(fbm(p+vec2(t*.6,t*.4)),fbm(p+vec2(7.1,t*.5)))-.5;
  warp=(n*uBend+inkGrad(uv)*uLens*.02)*smoothstep(0.,.35,I)*2.5;
  float a=clamp(I*uWash*.6,0.,1.);
  L=vec4(pal(I)*a,a);
}`,
    preset: { label: 'Heat haze', description: 'The picture wobbles and glows where the pointer has been, like air above a flame.', opacity: 1 },
  }),
  defineField({
    id: 'oilslick', label: 'Oil slick', icon: '◍', family: FAMILY, engine: 'ink',
    blurb: 'Thin-film interference: rainbow bands that flow with the thickness of what you painted.',
    look: { scale: 1, gain: 1.3, anim: 0.8, extra: [p('thick', 'Film thickness', 0.2, 4, 1.5), p('swirl', 'Swirl', 0, 2, 0.8), p('bands', 'Colour bands', 0.5, 6, 2, 0.1), p('irid', 'Iridescence', 0, 1, 0.7)] },
    ptr: { width: 0.12 }, mem: { decay: 0.975, spread: 0.55, turb: 0.6 }, fin: { glow: 0.3, contrast: 1.1 },
    colors: ['#0a0a14', '#3a2a7a', '#00c2a8', '#ffd166'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  warp=vec2(0.);
  float I=inkI(uv);float t=uClock*uAnim*.3;
  vec2 p=uv*AS2()*uScale*2.;
  float th=I*uThick+(fbm(p+t)-.5)*uSwirl*2.+fbm(p*2.-t)*.3;
  vec3 film=.5+.5*cos(6.2831*(th*uBands+vec3(0.,.33,.67)));
  vec3 c=mix(pal(th*.5+.3),film,uIrid);
  c+=clamp(length(inkGrad(uv))*12.,0.,1.)*.35;
  float a=smoothstep(0.,.12,I)*clamp(.45+I,0.,1.);
  L=vec4(c*a,a);
}`,
    preset: { label: 'Oil slick', description: 'A rainbow film that spreads and swirls over the picture, thickest where you have been.', opacity: 1 },
  }),
  defineField({
    id: 'frost', label: 'Frost crystals', icon: '❄', family: FAMILY, engine: 'ink',
    blurb: 'Ice grows cell by cell under the pointer: faceted crystals, bright seams and glints.',
    look: { scale: 1, gain: 1.3, anim: 1, extra: [p('cell', 'Crystal size', 3, 40, 14, 0.5), p('edge', 'Seam width', 0.02, 0.4, 0.12), p('warp', 'Seam waviness', 0, 2, 0.5), p('sparkle', 'Sparkle', 0, 2, 0.6)] },
    ptr: { width: 0.1 }, mem: { decay: 0.985, spread: 0.2 },
    colors: ['#0b1d3a', '#4aa3ff', '#bfe6ff', '#ffffff'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  warp=vec2(0.);
  float I=inkI(uv);
  vec2 p=uv*AS2()*uCell;
  vec4 v=voronoi(p+(fbm(p*.4)-.5)*uWarp*2.);
  float edge=1.-smoothstep(0.,uEdge,v.x);
  float facet=hash21(v.zw);
  float fill=smoothstep(facet*.8,facet*.8+.2,I*1.3);
  vec3 c=mix(pal(.15+facet*.5+.25*(1.-v.y)),pal(1.),edge*.9);
  float sp=pow(hash21(floor(p*5.)+floor(uClock*uAnim*4.)),24.)*uSparkle;
  c+=sp;
  float a=clamp(fill*(.55+.45*edge)+sp*fill,0.,1.);
  L=vec4(c*a,a);
}`,
    preset: { label: 'Frost crystals', description: 'Ice crystals grow across the screen wherever the pointer breathes on it.', opacity: 1 },
  }),
  defineField({
    id: 'contour', label: 'Topographic contours', icon: '◎', family: FAMILY, engine: 'ink',
    blurb: 'Treats what you painted as a hill and draws its contour lines, with an optional filled relief.',
    look: { scale: 1, gain: 1.6, anim: 0.6, extra: [p('levels', 'Contour lines', 3, 40, 14, 1), p('line', 'Line weight', 0.05, 1, 0.3), p('fill', 'Filled relief', 0, 1, 0.25), p('wobble', 'Hand-drawn wobble', 0, 2, 0.4)] },
    ptr: { width: 0.14 }, mem: { decay: 0.975, spread: 0.6 },
    colors: ['#0f1a14', '#2f6f4f', '#b9d96c', '#fff6d1'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  warp=vec2(0.);
  float raw=fld(uv).r*uGain;
  float wob=(fbm(uv*AS2()*uScale*5.+uClock*uAnim*.1)-.5)*uWobble*.25;
  float s=(1.-exp(-raw))+wob*smoothstep(0.,.15,raw);
  float f=fract(s*uLevels);float dd=min(f,1.-f);
  float line=(1.-smoothstep(0.,uLine*.5,dd))*smoothstep(.01,.06,s);
  float fillA=uFill*.6*smoothstep(0.,.08,s);
  float a=clamp(line+fillA,0.,1.);
  vec3 c=mix(pal(s*.8)*uFill,pal(s)*1.2,line);
  L=vec4(c*a,a);
}`,
    preset: { label: 'Topographic contours', description: 'Map-style contour lines that rise like hills where the pointer travels.', opacity: 1 },
  }),
  defineField({
    id: 'halftone', label: 'Halftone print', icon: '⁘', family: FAMILY, engine: 'ink',
    blurb: 'A printed screen: dots, squares or lines that swell with the field. Set the angle and the shape.',
    look: { scale: 1, gain: 1.5, anim: 1, extra: [p('angle', 'Screen angle', -90, 90, 45, 1, '°'), p('dot', 'Dot size', 0.3, 1.6, 1), opt('shape', 'Shape', ['Dots', 'Squares', 'Lines'], 0), p('soft', 'Edge softness', 0, 1, 0.2), p('jitter', 'Colour variation', 0, 1, 0.3)] },
    ptr: { width: 0.12 }, mem: { decay: 0.96, spread: 0.4 },
    colors: ['#111111', '#ff3d6e', '#ffd23f', '#3bceac'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  warp=vec2(0.);
  float ang=uAngle*.01745;
  vec2 pp=rot2(uv*AS2()*uScale*30.,ang);
  vec2 cell=floor(pp),f=fract(pp)-.5;
  vec2 cu=rot2(cell+.5,-ang)/(uScale*30.)/AS2();
  float Ic=inkI(cu);
  float r=sqrt(Ic)*.62*uDot;
  int sh=int(uShape+.5);
  float dd=sh==0?length(f)-r:(sh==1?max(abs(f.x),abs(f.y))-r*.85:abs(f.y)-r*.5);
  float a=(1.-smoothstep(-uSoft*.15-.02,uSoft*.15+.02,dd))*step(.01,Ic);
  vec3 c=pal(Ic+.1*hash21(cell)*uJitter*6.);
  L=vec4(c*a,a);
}`,
    preset: { label: 'Halftone print', description: 'A comic-book dot screen that swells under the pointer.', opacity: 1 },
  }),
  defineField({
    id: 'glitch', label: 'Glitch slices', icon: '▤', family: FAMILY, engine: 'ink',
    blurb: 'Slices and blocks of the picture tear sideways and split into colour wherever the pointer has disturbed it.',
    look: { scale: 1, gain: 1.6, anim: 1.2, extra: [p('bands', 'Slices', 4, 140, 40, 1), p('shift', 'Tear distance', 0, 0.4, 0.14, 0.005), p('blocks', 'Corrupt blocks', 0, 1, 0.3), p('noise', 'Scan noise', 0, 1, 0.5)] },
    ptr: { width: 0.13 }, mem: { decay: 0.93, spread: 0.1 }, ren: { split: 0.7 },
    colors: ['#00ffd5', '#ff2bd6', '#ffe14d', '#3b82f6'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  float I=inkI(uv);float t=floor(uClock*uAnim*8.);
  float band=floor(uv.y*uBands);
  float rnd=hash21(vec2(band,t));
  float on=step(1.-uBlocks*.9-.1,rnd)*I;
  warp=vec2((hash21(vec2(band+7.,t))-.5)*uShift*2.*smoothstep(0.,.3,I)*(.4+.6*step(.5,rnd)),0.);
  vec2 bc=floor(uv*vec2(uBands*.5*ASP(),uBands*.5));
  float blk=step(1.-uBlocks*.35,hash21(bc+t))*I;
  float scan=.5+.5*sin(uv.y*uResolution.y*1.5);
  float a=clamp(blk*.85+on*.2*uNoise*scan,0.,1.);
  L=vec4(pal(hash21(bc+t+3.))*a,a);
}`,
    preset: { label: 'Glitch slices', description: 'The picture tears into shifted slices and coloured blocks around the pointer.', opacity: 1 },
  }),
  defineField({
    id: 'mosaic', label: 'Pixel mosaic', icon: '▦', family: FAMILY, engine: 'ink',
    blurb: 'Turns the picture into tiles under the pointer, with tinted tiles and grout lines you can switch on.',
    look: { scale: 1, gain: 1.6, anim: 1, extra: [p('cell', 'Tile count', 6, 120, 36, 1), p('wash', 'Tile tint', 0, 1, 0.5), p('grout', 'Grout lines', 0, 1, 0.3)] },
    ptr: { width: 0.12 }, mem: { decay: 0.955, spread: 0.2 },
    colors: ['#1b1464', '#7b2ff7', '#f107a3', '#00d2ff'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  vec2 AS=AS2();
  vec2 cells=floor(uv*AS*uCell);
  vec2 cuv=(cells+.5)/uCell/AS;
  float Ic=inkI(cuv);
  float on=smoothstep(.02,.15,Ic);
  warp=(cuv-uv)*on;
  vec2 f=fract(uv*AS*uCell);
  float gm=min(min(f.x,1.-f.x),min(f.y,1.-f.y));
  float grout=(1.-smoothstep(0.,uGrout*.12,gm))*on;
  float a=clamp(on*uWash*(.25+.75*Ic)+grout*.5,0.,1.);
  L=vec4(pal(hash21(cells)*.6+Ic*.4)*a,a);
}`,
    preset: { label: 'Pixel mosaic', description: 'Tiles of colour that pixelate the picture where you move.', opacity: 1 },
  }),
  defineField({
    id: 'nebula', label: 'Nebula dust', icon: '✧', family: FAMILY, engine: 'ink',
    blurb: 'Domain-warped gas clouds with a hidden star field that the pointer uncovers.',
    look: { scale: 1, gain: 1.4, anim: 0.8, extra: [p('warp', 'Cloud warping', 0, 2, 1), p('dust', 'Dust contrast', 0.3, 3, 1.4), p('stars', 'Star density', 10, 120, 50, 1), p('twinkle', 'Twinkle', 0, 4, 1.5)] },
    ptr: { width: 0.14, ambient: 0.3 }, mem: { decay: 0.975, spread: 0.5 }, fin: { glow: 0.5 },
    colors: ['#050014', '#2a0a6b', '#c026d3', '#38bdf8', '#fdf4ff'], gen: `
void gen(vec2 uv,out vec4 L,out vec2 warp){
  warp=vec2(0.);
  float I=inkI(uv);vec2 p=uv*AS2()*uScale*2.;float t=uClock*uAnim*.05;
  vec2 q=vec2(fbm(p+t),fbm(p+vec2(5.2,1.3)-t));
  float n=fbm(p+q*uWarp*2.+t);
  float neb=clamp(I*(.35+pow(smoothstep(.2,.9,n),uDust)*1.3),0.,1.);
  vec2 sp=uv*AS2()*uStars;vec2 sc=floor(sp);float h=hash21(sc);
  float dd=length(fract(sp)-.5-(hash22(sc+3.)-.5)*.6);
  float star=step(.9,h)*smoothstep(.12,0.,dd)*(.6+.4*sin(uClock*uTwinkle*3.+h*40.))*smoothstep(0.,.3,I);
  vec3 col=pal(n*.8+q.x*.3)*neb+vec3(1.,.95,.9)*star;
  L=vec4(col,clamp(neb+star*.9,0.,1.));
}`,
    preset: { label: 'Nebula dust', description: 'Violet and cyan gas clouds with twinkling stars that appear where you drag.', opacity: 1 },
  }),
];
