import { useState } from "react"

function Login({ onLogin }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    if (email === "") return setError("Please enter your email")
    if (password === "") return setError("Please enter your password")
    if (password.length < 6) return setError("Password must be at least 6 characters")

    setError("")
    setLoading(true)

    try {
      const response = await fetch("http://localhost:5000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error)
        setLoading(false)
        return
      }

      localStorage.setItem("token", data.token)
      localStorage.setItem("user", JSON.stringify(data.user))

      onLogin(data.user.role)

    }  catch {
  setError("Cannot connect to server. Please try again.")
  setLoading(false)
}
  }

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>KrishaSure</h1>
        <div className="logo-row">
          <img src="/Logo.jpeg" alt="KrishaSure Logo" />
          <p>Powered by Krisha Solutions</p>
        </div>
        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
  type="password"
  placeholder="Password"
  value={password}
  onChange={(e) => setPassword(e.target.value)}
  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
/>
        {error && <p className="error-msg">{error}</p>}
        <button onClick={handleLogin} disabled={loading}>
          {loading ? "Logging in..." : "Login"}
        </button>
      </div>
    </div>
  )
}

export default Login