const escapeHtml = (value: string): string =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const baseHtml = (title: string, intro: string, ctaLabel?: string, ctaUrl?: string, footer?: string): string => {
  const safeTitle = escapeHtml(title);
  const safeIntro = escapeHtml(intro);
  const safeCtaLabel = ctaLabel ? escapeHtml(ctaLabel) : '';
  const safeCtaUrl = ctaUrl ? escapeHtml(ctaUrl) : '';
  const safeFooter = footer ? escapeHtml(footer) : '';

  return `
  <div style="background:#09090b;padding:24px;font-family:Arial,sans-serif;color:#e4e4e7;">
    <div style="max-width:620px;margin:0 auto;border:1px solid #27272a;background:#111114;border-radius:10px;overflow:hidden;">
      <div style="padding:16px 20px;background:linear-gradient(135deg,#991b1b,#18181b);">
        <h1 style="margin:0;font-size:18px;line-height:1.4;color:#fff;">${safeTitle}</h1>
      </div>
      <div style="padding:20px;">
        <p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;color:#d4d4d8;">${safeIntro}</p>
        ${
          safeCtaUrl && safeCtaLabel
            ? `<p style="margin:0 0 14px 0;">
                <a href="${safeCtaUrl}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#b91c1c;color:#fff;text-decoration:none;font-weight:700;font-size:13px;">
                  ${safeCtaLabel}
                </a>
              </p>
              <p style="margin:0;font-size:12px;line-height:1.5;color:#71717a;word-break:break-all;">
                Se o botao nao funcionar, copie este link: ${safeCtaUrl}
              </p>`
            : ''
        }
      </div>
      ${
        safeFooter
          ? `<div style="padding:14px 20px;border-top:1px solid #27272a;font-size:12px;color:#71717a;line-height:1.5;">
              ${safeFooter}
            </div>`
          : ''
      }
    </div>
  </div>`;
};

export const buildEmailVerificationTemplate = (params: {
  username: string;
  verifyUrl: string;
  expiresMinutes: number;
}) => {
  const subject = 'Confirme seu e-mail - Backstabber Brasil';
  const intro = `Ola ${params.username}, confirme seu e-mail para concluir o cadastro no painel Backstabber Brasil. Este link expira em ${params.expiresMinutes} minutos.`;
  const footer = 'Se voce nao criou esta conta, ignore esta mensagem.';
  const text = [
    `Ola ${params.username},`,
    '',
    'Confirme seu e-mail para concluir o cadastro no Backstabber Brasil:',
    params.verifyUrl,
    '',
    `Este link expira em ${params.expiresMinutes} minutos.`,
    'Se voce nao criou esta conta, ignore esta mensagem.',
  ].join('\n');

  return {
    subject,
    text,
    html: baseHtml(
      'Confirmacao de e-mail',
      intro,
      'Confirmar e-mail',
      params.verifyUrl,
      footer,
    ),
  };
};

export const buildPasswordResetTemplate = (params: {
  username: string;
  resetUrl: string;
  expiresMinutes: number;
}) => {
  const subject = 'Reset de senha - Backstabber Brasil';
  const intro = `Recebemos um pedido de reset de senha para a conta ${params.username}. Use o link abaixo para definir uma nova senha. Este link expira em ${params.expiresMinutes} minutos.`;
  const footer = 'Se voce nao solicitou reset de senha, ignore esta mensagem.';
  const text = [
    `Conta: ${params.username}`,
    '',
    'Use este link para resetar sua senha:',
    params.resetUrl,
    '',
    `Este link expira em ${params.expiresMinutes} minutos.`,
    'Se voce nao solicitou reset de senha, ignore esta mensagem.',
  ].join('\n');

  return {
    subject,
    text,
    html: baseHtml(
      'Reset de senha',
      intro,
      'Definir nova senha',
      params.resetUrl,
      footer,
    ),
  };
};

export const buildPasswordChangedTemplate = (params: { username: string }) => {
  const subject = 'Senha alterada - Backstabber Brasil';
  const intro = `A senha da conta ${params.username} foi alterada com sucesso.`;
  const footer = 'Se voce nao reconhece esta alteracao, troque a senha novamente e contate a staff imediatamente.';
  const text = [
    `A senha da conta ${params.username} foi alterada.`,
    'Se voce nao reconhece esta alteracao, troque a senha novamente e contate a staff.',
  ].join('\n');

  return {
    subject,
    text,
    html: baseHtml('Senha alterada', intro, undefined, undefined, footer),
  };
};

export const buildVipPurchaseReceiptTemplate = (params: {
  username: string;
  plan: string;
  durationDays?: number;
  amount?: number;
  transactionDateIso: string;
}) => {
  const subject = 'Compra de VIP confirmada - Backstabber Brasil';
  const durationText = params.durationDays && Number(params.durationDays) > 0
    ? `${params.durationDays} dias`
    : 'duracao nao informada';
  const amountText = Number.isFinite(Number(params.amount))
    ? `R$ ${Number(params.amount).toFixed(2)}`
    : 'valor nao informado';
  const dateText = new Date(params.transactionDateIso).toLocaleString('pt-BR');
  const intro = `Ola ${params.username}, sua compra foi registrada com sucesso. Plano: ${params.plan}. Duracao: ${durationText}. Valor: ${amountText}. Data: ${dateText}.`;
  const footer = 'Se houver qualquer divergencia, abra ticket com a staff e informe o horario da compra.';
  const text = [
    `Ola ${params.username},`,
    '',
    'Compra de VIP registrada com sucesso.',
    `Plano: ${params.plan}`,
    `Duracao: ${durationText}`,
    `Valor: ${amountText}`,
    `Data: ${dateText}`,
    '',
    footer,
  ].join('\n');

  return {
    subject,
    text,
    html: baseHtml('Compra de VIP confirmada', intro, undefined, undefined, footer),
  };
};
