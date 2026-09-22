const params = new URLSearchParams(location.search);
const dev = params.get('dev');

if (dev) {
  import('./dev/devMain').then((m) => m.runDev(dev, params));
} else {
  import('./app/App').then((m) => m.boot());
}
