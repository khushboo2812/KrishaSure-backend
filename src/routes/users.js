router.post('/:id/resend-welcome', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user

    const userResult = await pool.query('SELECT * FROM Users WHERE id = $1 AND companyId = $2', [id, companyId])
    const user = userResult.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const tempPassword = generateTempPassword()
    const hashedPassword = await bcrypt.hash(tempPassword, 10)

    await pool.query(
      'UPDATE Users SET password = $1, mustChangePassword = true WHERE id = $2',
      [hashedPassword, id]
    )

    sendEmail(
      user.email,
      'Welcome to KrishaSure!! 🎉',
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">Welcome to KrishaSure!!</h1>
          <p>Hi ${user.name},</p>
          <p><strong>Email:</strong> ${user.email}</p>
          <p><strong>Temporary Password:</strong> ${tempPassword}</p>
          <a href="https://app.krishasure.io" style="background: #00C2CB; color: #0A2540; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Login to KrishaSure</a>
          <br/><br/>
          <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
        </div>
      `
    )

    res.json({ message: 'Welcome email resent successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})