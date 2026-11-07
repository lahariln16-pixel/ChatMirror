/* ChatMirror motion layer: progressive enhancement, no framework dependency. */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const titleSelector = '.login-card h1, .empty-state h2, .chat-title';

  function animateTitle(element, variant = 'rise') {
    if (!element || element.dataset.cmAnimating === 'true' || reduceMotion.matches) return;
    const text = element.textContent.trim();
    if (!text) return;

    element.dataset.cmAnimating = 'true';
    element.classList.remove('cm-title-enter', 'cm-title-shimmer', 'cm-title-underline');
    if (variant === 'shimmer') {
      element.classList.add('cm-title-shimmer');
      element.dataset.cmAnimating = 'false';
      return;
    }
    if (variant === 'underline') {
      element.classList.add('cm-title-underline', 'cm-title-enter');
      element.dataset.cmAnimating = 'false';
      return;
    }

    element.classList.add('cm-title-enter');
    element.addEventListener('animationend', () => {
      element.classList.remove('cm-title-enter');
      element.dataset.cmAnimating = 'false';
    }, { once: true });
  }

  function decorateBrand() {
    document.querySelectorAll('.logo, .brand strong').forEach((brand) => {
      if (brand.dataset.cmBrandReady) return;
      brand.dataset.cmBrandReady = 'true';
      brand.classList.add('cm-title-shimmer');
    });
  }

  function runInitialMotion() {
    decorateBrand();
    document.querySelectorAll(titleSelector).forEach((title) => animateTitle(title));
  }

  let titleObserver;
  function observeDynamicTitles() {
    const target = document.getElementById('chatTitle');
    if (!target || titleObserver) return;
    titleObserver = new MutationObserver(() => {
      target.dataset.cmAnimating = 'false';
      animateTitle(target, 'rise');
    });
    titleObserver.observe(target, { childList: true, characterData: true, subtree: true });
  }

  function init() {
    runInitialMotion();
    observeDynamicTitles();
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.matches?.(titleSelector)) animateTitle(node);
          node.querySelectorAll?.(titleSelector).forEach((title) => animateTitle(title));
        }
      }
      decorateBrand();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    reduceMotion.addEventListener?.('change', () => {
      if (reduceMotion.matches) {
        document.querySelectorAll('.cm-title-enter').forEach((node) => node.classList.remove('cm-title-enter'));
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
