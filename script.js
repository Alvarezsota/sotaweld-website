document.getElementById('year').textContent = new Date().getFullYear();

const menuToggle = document.getElementById('menuToggle');
const mobileNav = document.getElementById('mobileNav');
menuToggle.addEventListener('click', () => {
  mobileNav.classList.toggle('open');
});
mobileNav.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => mobileNav.classList.remove('open'));
});

document.querySelectorAll('.m-faq-item').forEach(item => {
  const question = item.querySelector('.m-faq-question');
  question.addEventListener('click', () => {
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.m-faq-item').forEach(i => {
      i.classList.remove('open');
      i.querySelector('.icon').textContent = '+';
    });
    if (!isOpen) {
      item.classList.add('open');
      question.querySelector('.icon').textContent = '−';
    }
  });
});

const sb = supabase.createClient(
  'https://woqzbterwialanccprhp.supabase.co',
  'sb_publishable_HGtY9w_Oays9WK4xkOnyYA_tk0RMQzO'
);

const quoteForm = document.getElementById('quoteForm');
if (quoteForm) {
  quoteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('quoteSubmitBtn');
    const errEl = document.getElementById('quoteError');
    const successEl = document.getElementById('quoteSuccess');
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Sending...';

    const name = document.getElementById('qName').value.trim();
    const phone = document.getElementById('qPhone').value.trim();
    const email = document.getElementById('qEmail').value.trim();
    const message = document.getElementById('qMessage').value.trim();

    const { error } = await sb.from('quote_requests').insert({
      name, phone, email: email || null, message
    });

    if (error) {
      errEl.textContent = 'Something went wrong. Please call or text us instead.';
      btn.disabled = false;
      btn.textContent = 'Request a Quote';
      console.error(error);
      return;
    }

    quoteForm.style.display = 'none';
    successEl.style.display = 'block';
  });
}
