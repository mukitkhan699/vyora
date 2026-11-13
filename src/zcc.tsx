// ZUNARI CONTROL CENTER - Simple helper functions
import React from 'react';

export const ZCC = {
  fmt: {
    num(v) {
      if (v === null || v === undefined) return '—';
      return Number(v).toLocaleString('en-US');
    },
    money(v, dp) {
      if (v === null || v === undefined) return '—';
      const dollars = Number(v);
      if (dp === 0) return '$' + dollars.toLocaleString('en-US');
      return '$' + dollars.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    },
    pct(v, dp) {
      if (v === null || v === undefined) return '—';
      return Number(v).toFixed(dp || 1) + '%';
    },
  },

  frag: {
    badge(label, kind, size) {
      return '<span class="zc-badge ' + kind + ' ' + size + '">' + label + '</span>';
    },

    avatar(initials, hue, size) {
      return '<div class="zc-avatar ' + size + '" style="background-color: #F3F4F6">' + initials + '</div>';
    },
  },

  NAV: [],
  flatNav: [],
  mobileNavIds: [],

  state: {
    route: 'overview',
    theme: 'dark',
    sidebar: 'expanded',
    sampleNotice: true,
    toast: null,
  },

  go(route) {
    this.state.route = route;
  },

  icon(name, className) {
    return '<use href="#i-' + name + '" class="' + className + '">';
  },

  screens: {},
  
  registerScreen(route, config) {
    this.screens[route] = config;
  },
},

if (typeof window !== 'undefined') {
  window.ZCC = ZCC;
}
