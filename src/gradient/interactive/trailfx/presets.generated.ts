/* Generated: the built-in Trail FX looks as pass-stack overrides on top of the pass defaults. */
export interface TrailFxPresetRow { id: string; label: string; group: string; description: string; passes: { kind: string; p?: Record<string, number>; colors?: string[] }[] }
export const TRAILFX_PRESET_ROWS: TrailFxPresetRow[] = [
 {
  "id": "quicksilver",
  "label": "Quicksilver",
  "group": "Metal",
  "description": "Brushed liquid metal.",
  "passes": [
   {
    "kind": "base",
    "p": {
     "style": 1
    }
   },
   {
    "kind": "reveal",
    "p": {
     "displace": 0.7
    }
   },
   {
    "kind": "blur",
    "p": {}
   },
   {
    "kind": "diffuse",
    "p": {
     "amount": 0.08
    }
   },
   {
    "kind": "liquify",
    "p": {
     "mix": 0.4
    }
   },
   {
    "kind": "sheen",
    "p": {
     "bump": 9,
     "strength": 0.45,
     "rim": 0.06
    }
   },
   {
    "kind": "rays",
    "p": {}
   }
  ]
 },
 {
  "id": "molten-gold",
  "label": "Molten gold",
  "group": "Metal",
  "description": "Gold that flows where you push it.",
  "passes": [
   {
    "kind": "base",
    "p": {
     "style": 8
    }
   },
   {
    "kind": "reveal",
    "p": {
     "displace": 0.75
    }
   },
   {
    "kind": "blur",
    "p": {}
   },
   {
    "kind": "diffuse",
    "p": {
     "amount": 0.08
    }
   },
   {
    "kind": "liquify",
    "p": {
     "mix": 0.42
    }
   },
   {
    "kind": "sheen",
    "p": {
     "bump": 11,
     "shine": 16,
     "strength": 0.5
    }
   },
   {
    "kind": "rays",
    "p": {
     "decay": 0.978,
     "gain": 0.55
    },
    "colors": [
     "#ffd98c"
    ]
   }
  ]
 },
 {
  "id": "ink-marble",
  "label": "Ink marble",
  "group": "Metal",
  "description": "Marbled ink folded by each swipe.",
  "passes": [
   {
    "kind": "base",
    "p": {
     "style": 6
    }
   },
   {
    "kind": "reveal",
    "p": {
     "displace": 1,
     "aberr": 0.06
    }
   },
   {
    "kind": "blur",
    "p": {}
   },
   {
    "kind": "diffuse",
    "p": {
     "amount": 0.08
    }
   },
   {
    "kind": "liquify",
    "p": {
     "mix": 0.35
    }
   },
   {
    "kind": "sheen",
    "p": {
     "bump": 12,
     "strength": 0.35,
     "rim": 0.05
    }
   },
   {
    "kind": "rays",
    "p": {
     "threshold": 0.35,
     "gain": 0.35
    }
   }
  ]
 },
 {
  "id": "prism-reveal",
  "label": "Prism reveal",
  "group": "Colour",
  "description": "A hidden spectrum revealed by speed.",
  "passes": [
   {
    "kind": "base",
    "p": {
     "style": 2
    }
   },
   {
    "kind": "reveal",
    "p": {
     "displace": 0.9,
     "aberr": 0.22
    }
   },
   {
    "kind": "blur",
    "p": {
     "aberr": 0.2
    }
   },
   {
    "kind": "diffuse",
    "p": {
     "amount": 0.08
    }
   },
   {
    "kind": "liquify",
    "p": {
     "mix": 0.31
    }
   },
   {
    "kind": "sheen",
    "p": {
     "strength": 0.2
    }
   },
   {
    "kind": "rays",
    "p": {
     "gain": 0.4
    },
    "colors": [
     "#ffe6ff"
    ]
   }
  ]
 },
 {
  "id": "aurora-veil",
  "label": "Aurora veil",
  "group": "Colour",
  "description": "Northern light pulled by hand.",
  "passes": [
   {
    "kind": "base",
    "p": {
     "style": 5
    }
   },
   {
    "kind": "reveal",
    "p": {
     "displace": 0.9,
     "decay": 0.8
    }
   },
   {
    "kind": "blur",
    "p": {
     "scale": 0.35,
     "decay": 0.7
    }
   },
   {
    "kind": "diffuse",
    "p": {
     "amount": 0.1
    }
   },
   {
    "kind": "liquify",
    "p": {
     "mix": 0.5
    }
   },
   {
    "kind": "sheen",
    "p": {
     "strength": 0.15
    }
   },
   {
    "kind": "rays",
    "p": {
     "threshold": 0.25,
     "decay": 0.98,
     "gain": 0.6
    },
    "colors": [
     "#b2ffe6"
    ]
   }
  ]
 },
 {
  "id": "ember-silk",
  "label": "Ember silk",
  "group": "Colour",
  "description": "Slow heat drawn into silk.",
  "passes": [
   {
    "kind": "base",
    "p": {
     "style": 4
    }
   },
   {
    "kind": "reveal",
    "p": {
     "displace": 0.8
    }
   },
   {
    "kind": "blur",
    "p": {}
   },
   {
    "kind": "diffuse",
    "p": {
     "amount": 0.12
    }
   },
   {
    "kind": "liquify",
    "p": {
     "mix": 0.45
    }
   },
   {
    "kind": "sheen",
    "p": {
     "strength": 0.25
    }
   },
   {
    "kind": "rays",
    "p": {
     "decay": 0.98,
     "gain": 0.8
    },
    "colors": [
     "#ffbf80"
    ]
   }
  ]
 },
 {
  "id": "reeded-glass",
  "label": "Reeded glass",
  "group": "Glass",
  "description": "Fluted glass that bends around your finger.",
  "passes": [
   {
    "kind": "base",
    "p": {
     "style": 3
    }
   },
   {
    "kind": "reveal",
    "p": {
     "displace": 1.1,
     "aberr": 0.1
    }
   },
   {
    "kind": "blur",
    "p": {}
   },
   {
    "kind": "diffuse",
    "p": {
     "amount": 0.04
    }
   },
   {
    "kind": "liquify",
    "p": {
     "mix": 0.2
    }
   },
   {
    "kind": "sheen",
    "p": {
     "bump": 14,
     "strength": 0.5
    }
   },
   {
    "kind": "rays",
    "p": {
     "threshold": 0.3
    },
    "colors": [
     "#ccffff"
    ]
   }
  ]
 },
 {
  "id": "glacier",
  "label": "Glacier",
  "group": "Glass",
  "description": "Cold veins that crack under motion.",
  "passes": [
   {
    "kind": "base",
    "p": {
     "style": 7
    }
   },
   {
    "kind": "reveal",
    "p": {
     "displace": 0.8,
     "aberr": 0.16
    }
   },
   {
    "kind": "blur",
    "p": {}
   },
   {
    "kind": "diffuse",
    "p": {
     "amount": 0.08
    }
   },
   {
    "kind": "liquify",
    "p": {
     "mix": 0.28
    }
   },
   {
    "kind": "sheen",
    "p": {
     "bump": 10,
     "strength": 0.4
    }
   },
   {
    "kind": "rays",
    "p": {
     "decay": 0.975,
     "gain": 0.45
    },
    "colors": [
     "#ccf2ff"
    ]
   }
  ]
 }
];
