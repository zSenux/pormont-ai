// Darstellung hell/dunkel: Skript für den <head> (ohne "use client", damit das Layout den Text bekommt)
export const THEME_KEY = "pm-theme";

/** Läuft im <head> vor dem ersten Bild, damit nichts hell aufblitzt. */
export const THEME_SCRIPT = `(function(){var K="${THEME_KEY}",d=document.documentElement,m1=matchMedia("(max-width: 767px)"),m2=matchMedia("(prefers-color-scheme: dark)");function mode(){try{return localStorage.getItem(K)||"auto"}catch(e){return "auto"}}function apply(){var m=mode(),dark=m==="dark"||(m==="auto"&&m1.matches)||(m==="system"&&m2.matches);d.classList.toggle("dark",dark);d.dataset.theme=m;var t=document.querySelector('meta[name="theme-color"]');if(t)t.setAttribute("content",dark?"#0b1117":"#092f50")}window.__pmTheme=function(m){try{localStorage.setItem(K,m)}catch(e){}apply()};apply();try{m1.addEventListener("change",apply);m2.addEventListener("change",apply)}catch(e){}})();`;

