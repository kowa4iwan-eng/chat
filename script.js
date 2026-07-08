const button = document.querySelector('#changeText');
const title = document.querySelector('h1');

button.addEventListener('click', () => {
  title.textContent = 'Працює! Сайт ожив 😎';
  button.textContent = 'Готово';
});
