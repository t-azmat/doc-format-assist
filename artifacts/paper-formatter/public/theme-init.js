// Applied before first paint so a dark-mode user never sees a white flash.
      (function () {
        try {
          var stored = localStorage.getItem('editorial-desk-theme');
          var dark = stored === 'dark' || ((!stored || stored === 'system') &&
            window.matchMedia('(prefers-color-scheme: dark)').matches);
          if (dark) document.documentElement.classList.add('dark');
        } catch (e) {}
      })();
