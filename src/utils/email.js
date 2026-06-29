

const configured = () => Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER);

let _transport = null;
const transport = async () => {
  if (_transport) return _transport;
  const nodemailer = (await import('nodemailer')).default;
  _transport = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT || 587),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  return _transport;
};

const send = async (to, subject, text, html) => {
  if (!configured()) {
    console.log(`\n[EMAIL STUB] → ${to}\n${subject}\n${text}\n`);
    return;
  }
  try {
    const t = await transport();
    await t.sendMail({ from: process.env.EMAIL_FROM || process.env.EMAIL_USER, to, subject, text, html });
  } catch (e) {
    console.error('[EMAIL] göndərmə xətası:', e.message);
  }
};

const C = { pri: '#2F5BD7', ink: '#15233B', muted: '#5d6b82', line: '#E4E9F2', bg: '#F5F7FB' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const layout = ({ heading, bodyHtml, preheader = '' }) => `<!DOCTYPE html>
<html lang="az"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting"></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};padding:24px 12px;">
 <tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;">
    <!-- header -->
    <tr><td style="padding:8px 4px 18px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="width:34px;height:34px;background:${C.pri};border-radius:8px;color:#fff;font:700 18px ${FONT};text-align:center;vertical-align:middle;">E</td>
        <td style="padding-left:10px;font:700 18px ${FONT};color:${C.ink};">EduCan</td>
      </tr></table>
    </td></tr>
    <!-- card -->
    <tr><td style="background:#fff;border:1px solid ${C.line};border-radius:14px;padding:32px;">
      <h1 style="margin:0 0 14px;font:600 20px ${FONT};color:${C.ink};">${esc(heading)}</h1>
      <div style="font:400 15px/1.6 ${FONT};color:${C.ink};">${bodyHtml}</div>
    </td></tr>
    <!-- footer -->
    <tr><td style="padding:18px 4px;font:400 12px/1.5 ${FONT};color:${C.muted};">
      Bu mesaj EduCan tərəfindən avtomatik göndərilib. Bu əməliyyatı siz başlatmamısınızsa, məktubu nəzərə almayın.<br>
      © EduCan
    </td></tr>
  </table>
 </td></tr>
</table>
</body></html>`;

export const button = (label, url) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr>
  <td align="center" bgcolor="${C.pri}" style="border-radius:10px;">
    <a href="${esc(url)}" target="_blank"
       style="display:inline-block;padding:13px 26px;font:600 15px ${FONT};color:#fff;text-decoration:none;border-radius:10px;">
       ${esc(label)}</a>
  </td>
</tr></table>`;

export const codeBox = (code) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;"><tr>
  <td align="center" style="background:${C.bg};border:1px solid ${C.line};border-radius:12px;padding:18px 28px;
      font:700 34px ${FONT};letter-spacing:10px;color:${C.ink};">${esc(code)}</td>
</tr></table>`;

export const sendOtpEmail = async (email, code, ttlMin) => {
  const text = `Email-inizi təsdiqləmək üçün kod: ${code}\n\nKod ${ttlMin} dəqiqə etibarlıdır. Bunu siz istəməmisinizsə, nəzərə almayın.`;
  const html = layout({
    heading: 'Email-inizi təsdiqləyin',
    preheader: `Təsdiq kodunuz: ${code}`,
    bodyHtml: `<p style="margin:0 0 4px;">Qeydiyyatı tamamlamaq üçün aşağıdakı kodu daxil edin:</p>
      ${codeBox(code)}
      <p style="margin:0;color:${C.muted};font-size:13px;">Kod <b>${ttlMin} dəqiqə</b> etibarlıdır.</p>`,
  });
  return send(email, 'EduCan — təsdiq kodu', text, html);
};

export const sendPasswordResetEmail = async (email, resetUrl) => {
  const text = `Parolunuzu sıfırlamaq üçün link (60 dəq etibarlıdır):\n${resetUrl}\n\nBunu siz istəməmisinizsə, bu məktubu nəzərə almayın.`;
  const html = layout({
    heading: 'Parol sıfırlama',
    preheader: 'Parolunuzu sıfırlamaq üçün link',
    bodyHtml: `<p style="margin:0 0 6px;">Parolunuzu sıfırlamaq üçün düyməyə klikləyin:</p>
      ${button('Parolu sıfırla', resetUrl)}
      <p style="margin:10px 0 0;color:${C.muted};font-size:13px;">Link 60 dəqiqə etibarlıdır. Düymə işləmirsə, bu ünvanı brauzerə kopyalayın:<br>
      <a href="${esc(resetUrl)}" style="color:${C.pri};word-break:break-all;">${esc(resetUrl)}</a></p>`,
  });
  return send(email, 'EduCan — parol sıfırlama', text, html);
};

export const sendWelcomeEmail = async (email, { name, role } = {}) => {
  const rl = role === 'teacher' ? 'müəllim' : role === 'admin' ? 'admin' : 'tələbə';
  const text = `Salam ${name || ''}, EduCan hesabınız uğurla yaradıldı (${rl}). Xoş gəldiniz!`;
  const html = layout({
    heading: 'Xoş gəldiniz! 🎉',
    preheader: 'EduCan hesabınız uğurla yaradıldı',
    bodyHtml: `<p style="margin:0 0 10px;">Salam ${esc(name || '')}, EduCan hesabınız uğurla yaradıldı.</p>
      <p style="margin:0;color:${C.muted};font-size:14px;">Profil növü: <b style="color:${C.ink};">${esc(rl)}</b>. İndi platformadan tam istifadə edə bilərsiniz.</p>`,
  });
  return send(email, 'EduCan — xoş gəldiniz', text, html);
};

export const sendTopupSuccessEmail = async (email, { amount, balance, name } = {}) => {
  const amt = Number(amount).toFixed(2);
  const bal = balance != null ? Number(balance).toFixed(2) : null;
  const text = `Salam ${name || ''}, balansınız ${amt} ₼ artırıldı.` + (bal != null ? ` Cari balans: ${bal} ₼.` : '');
  const html = layout({
    heading: 'Balansınız artırıldı ✅',
    preheader: `+${amt} ₼ balansınıza əlavə olundu`,
    bodyHtml: `<p style="margin:0 0 14px;">Salam ${esc(name || '')}, ödənişiniz uğurla tamamlandı.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font:400 14px ${FONT};">
        <tr><td style="padding:4px 0;color:${C.muted};width:140px;">Əlavə olunan</td><td style="padding:4px 0;color:${C.ink};font-weight:600;">+${esc(amt)} ₼</td></tr>
        ${bal != null ? `<tr><td style="padding:4px 0;color:${C.muted};">Cari balans</td><td style="padding:4px 0;color:${C.ink};font-weight:600;">${esc(bal)} ₼</td></tr>` : ''}
      </table>`,
  });
  return send(email, 'EduCan — balans artırıldı', text, html);
};

export const sendTeacherStatusEmail = async (email, status, reason) => {
  const messages = {
    approved: 'Profiliniz təsdiqləndi! Artıq tələbələrə görünürsünüz.',
    rejected: `Profiliniz təsdiqlənmədi. Səbəb: ${reason || 'qeyd edilməyib'}.`,
    suspended: 'Profiliniz müvəqqəti dayandırıldı. Ətraflı üçün bizimlə əlaqə saxlayın.',
    reinstated: 'Profiliniz yenidən aktivləşdirildi.',
  };
  const msg = messages[status] || `Status: ${status}`;
  const html = layout({
    heading: 'Profil statusu',
    preheader: msg,
    bodyHtml: `<p style="margin:0;">${esc(msg)}</p>`,
  });
  return send(email, 'EduCan — profil statusu', msg, html);
};

export const sendBookingConfirmation = async ({ studentEmail, teacherEmail, studentName, teacherName, startsAt, subject }) => {
  const when = new Date(startsAt).toLocaleString('az');
  const subj = subject ? ` (${subject})` : '';
  const row = (k, v) => `<tr><td style="padding:4px 0;color:${C.muted};width:120px;">${esc(k)}</td><td style="padding:4px 0;color:${C.ink};font-weight:600;">${esc(v)}</td></tr>`;

  if (studentEmail) {
    const text = `Salam ${studentName}, dərsiniz rezerv edildi.\nMüəllim: ${teacherName}${subj}\nVaxt: ${when}\nDərs vaxtı platformada "Dərsə qoşul" düyməsi aktiv olacaq.`;
    const html = layout({
      heading: 'Dərsiniz rezerv edildi ✅',
      preheader: `Müəllim: ${teacherName} · ${when}`,
      bodyHtml: `<p style="margin:0 0 12px;">Salam ${esc(studentName)}, dərsiniz uğurla rezerv olundu.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font:400 14px ${FONT};">
          ${row('Müəllim', teacherName + subj)}${row('Vaxt', when)}</table>
        <p style="margin:14px 0 0;color:${C.muted};font-size:13px;">Dərs vaxtı platformada “Dərsə qoşul” düyməsi aktivləşəcək.</p>`,
    });
    await send(studentEmail, 'EduCan — dərs təsdiqi', text, html);
  }
  if (teacherEmail) {
    const text = `Salam ${teacherName}, yeni dərs rezerv olundu.\nTələbə: ${studentName}${subj}\nVaxt: ${when}`;
    const html = layout({
      heading: 'Yeni rezerv 📅',
      preheader: `Tələbə: ${studentName} · ${when}`,
      bodyHtml: `<p style="margin:0 0 12px;">Salam ${esc(teacherName)}, yeni dərs rezerv olundu.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font:400 14px ${FONT};">
          ${row('Tələbə', studentName + subj)}${row('Vaxt', when)}</table>`,
    });
    await send(teacherEmail, 'EduCan — yeni rezerv', text, html);
  }
};
