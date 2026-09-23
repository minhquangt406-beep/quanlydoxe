document.addEventListener('DOMContentLoaded', () => {
  const chips = document.querySelectorAll('.chip');
  const input = document.getElementById('userInput');
  const sendBtn = document.getElementById('sendBtn');

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      input.value = chip.textContent.trim();
      input.focus();
    });
  });

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });

  function sendMessage() {
    const text = input.value.trim();
    if (text) {
      alert(`Đã gửi: "${text}"`);
      input.value = '';
    }
  }
});
