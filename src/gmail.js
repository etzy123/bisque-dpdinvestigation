const MailComposer = require('nodemailer/lib/mail-composer');
const config = require('./config');

async function getAccessToken() {
  const g = config.gmail;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: g.clientId,
      client_secret: g.clientSecret,
      refresh_token: g.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google token mislukt: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

function buildRaw({ to, subject, text, attachments }) {
  return new MailComposer({ from: config.gmail.from, to, subject, text, attachments })
    .compile()
    .build();
}

// Verstuurt via de Gmail API van support@bisquegolf.com, zodat de mail in Verzonden staat
// en de DPD-onderzoeken-tracker de thread herkent. Upload-endpoint: tot 35 MB.
async function sendMail(mail) {
  const raw = await buildRaw(mail);
  const res = await fetch(
    'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${await getAccessToken()}`, 'Content-Type': 'message/rfc822' },
      body: raw,
    }
  );
  if (!res.ok) throw new Error(`Gmail verzenden mislukt: ${res.status} ${await res.text()}`);
  return res.json(); // { id, threadId }
}

module.exports = { sendMail, buildRaw };
