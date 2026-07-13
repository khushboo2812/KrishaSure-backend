import { useState } from "react"
import Login from "./Login"
import Dashboard from "./Dashboard"
import "./App.css"

function App() {
  const [role, setRole] = useState(null)

  if (!role) {
    return <Login onLogin={(userRole) => setRole(userRole)} />
  }

  return <Dashboard onLogout={() => setRole(null)} role={role} />
}

export default App