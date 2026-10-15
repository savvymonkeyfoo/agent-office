/**
 * The "bring the pet back" button: shown once the desktop pet is set up on this computer,
 * it puts the pet back on the desktop after it's been quit.
 */
export async function bindPetButton(button: HTMLButtonElement, request: typeof fetch = fetch) {
  const available = await request('/api/pet').then((r) => (r.ok ? r.json() : null)).then((r) => r?.available === true, () => false);
  button.hidden = !available;
  if (!available) return;
  const idle = button.title;
  button.addEventListener('click', async () => {
    const res = await request('/api/pet/show', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => null);
    button.title = res?.ok ? 'The pet is on your desktop' : (res ? await res.text() : "Couldn't reach the office");
    setTimeout(() => { button.title = idle; }, 4000);
  });
}
