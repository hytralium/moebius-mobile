'use strict';
// Eigene Beispielmodelle in Moebius-Schreibweise.
// sims: Liste der Simulationen; view: Achsenwahl.
window.MOEBIUS_EXAMPLES = [
  {
    title: 'Begegnung zweier Körper',
    sims: [{
      name: 'Standard', reps: 1000, caseSensitive: false,
      text: `V_J=V_J+A_J*DT
S_J=S_J+V_J*DT

V_F=V_F+A_F*DT
S_F=S_F+V_F*DT

T=T+DT`,
      startValues: { v_j: '-5,5', a_j: '0', dt: '0,1', s_j: '300', v_f: '3,5', a_f: '0', s_f: '0', t: '0' },
    }],
    view: { x: 'T', y: ['S_J', 'S_F'] },
  },
  {
    title: 'Fall eines Regentropfens',
    sims: [{
      name: 'Regentropfen', reps: 400, caseSensitive: true,
      text: `A=pi/4*d^2
V=pi/6*d^3
m=V*roh_Wasser
F_G=m*g
F_LW=1/2*c_W*roh_Luft*A*v^2
F=F_G-F_LW
a=F/m

v=v+a*dt
s=s+(-v)*dt
t=t+dt`,
      startValues: { pi: '3,1416', d: '0,0015', roh_Wasser: '1000', g: '9,81', c_W: '0,25', roh_Luft: '1,29', v: '0', dt: '0,01', s: '1000', t: '0' },
    }],
    view: { x: 't', y: ['v', 'a'] },
  },
  {
    title: 'Senkrechter Wurf',
    sims: [{
      name: 'Wurf', reps: 400, caseSensitive: false,
      text: `v=v-g*dt
h=h+v*dt
t=t+dt`,
      startValues: { v: '20', g: '9,81', dt: '0,01', h: '0', t: '0' },
    }],
    view: { x: 't', y: ['h', 'v'] },
  },
  {
    title: 'Fallschirmsprung (mit if-Bedingung)',
    sims: [{
      name: 'Fallschirm', reps: 12000, caseSensitive: false,
      text: `F_G=m*g
F_L=1/2*cw*roh*A*v^2
a=(F_G-F_L)/m

if h<=1000 then A=A+0,02: cw=cw+0,004
if A>=25 then A=25
if cw>=1,3 then cw=1,3

v=v+a*dt
h=h-v*dt
t=t+dt`,
      startValues: { m: '85', g: '9,81', cw: '0,4', roh: '1,2', a: '0', v: '0', h: '4000', dt: '0,01', t: '0' },
    }],
    view: { x: 't', y: ['h'] },
  },
  {
    title: 'Überholvorgang (2 Simulationen)',
    sims: [
      {
        name: 'LKW', reps: 3000, caseSensitive: false,
        text: `s=s+v*dt
t=t+dt`,
        startValues: { s: '40', v: '22', dt: '0,01', t: '0' },
      },
      {
        name: 'PKW', reps: 3000, caseSensitive: false,
        text: `v=v+a*dt
if v>=v_max then a=0: v=v_max
s=s+v*dt
t=t+dt`,
        startValues: { v: '22', v_max: '36', a: '2,5', dt: '0,01', s: '0', t: '0' },
      },
    ],
    view: { x: 't', y: ['s [LKW]', 's [PKW]'] },
  },
  {
    title: 'Gedämpfte Federschwingung',
    sims: [{
      name: 'Federschwinger', reps: 2000, caseSensitive: true,
      text: `F=-D*s-b*v
a=F/m
v=v+a*dt
s=s+v*dt
E_kin=m/2*sqr(v): E_sp=D/2*sqr(s)
t=t+dt`,
      startValues: { D: '40', s: '0,1', b: '0,4', v: '0', m: '0,5', dt: '0,005', t: '0' },
    }],
    view: { x: 't', y: ['s', 'v'] },
  },
  {
    title: 'Entladung eines Kondensators',
    sims: [{
      name: 'Kondensator', reps: 500, caseSensitive: false,
      text: `U=Q/C
I=U/R
Q=Q-I*dt
t=t+dt`,
      startValues: { q: '0,001', c: '0,0001', r: '1000', dt: '0,001', t: '0' },
    }],
    view: { x: 't', y: ['U'] },
  },
];
