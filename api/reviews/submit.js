const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
 
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
 
const resend = new Resend(process.env.RESEND_API_KEY);
 
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
 
  const { email, city, rating, comment, feature_mentioned } = req.body;
 
  // Basic validation
  if (!city || !rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Invalid review data' });
  }
 
  try {
    // Insert review — approved defaults to false, requires manual approval in Supabase
    const { error } = await supabase
      .from('reviews')
      .insert({
        email: email || null,
        city,
        rating,
        comment: comment || null,
        feature_mentioned: feature_mentioned || null,
        approved: false,
      });
 
    if (error) throw error;
 
    // Notify via email (only for 5-star reviews worth approving quickly)
    if (rating === 5 && process.env.RESEND_API_KEY) {
      await resend.emails.send({
        from: 'noreply@unirenter.com.au',
        to: 'benjcarey75@gmail.com',
        subject: `⭐⭐⭐⭐⭐ New review — ${city}`,
        html: `
          <p><strong>New 5-star review from ${city}</strong></p>
          <p><strong>Email:</strong> ${email || 'not provided'}</p>
          <p><strong>Feature mentioned:</strong> ${feature_mentioned || 'none'}</p>
          <p><strong>Comment:</strong> ${comment || '(no comment)'}</p>
          <p><a href="https://supabase.com/dashboard">Approve in Supabase →</a></p>
        `,
      }).catch(() => {}); // fail silently — don't block the response
    }
 
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Review submit error:', err);
    return res.status(500).json({ error: 'Failed to save review' });
  }
};
