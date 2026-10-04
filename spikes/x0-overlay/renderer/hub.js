const input = document.getElementById('message');
input.addEventListener('input', (event) => {
  window.x0.hubInput(input.value, event.data?.length || 0);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') input.blur();
  if (event.ctrlKey && event.key.toLowerCase() === 'q') {
    event.preventDefault();
    window.x0.quit();
  }
});
