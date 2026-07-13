import { useState, useEffect } from "react"
import TicketDetail from "./TicketDetail"

const statusOrder = {
  "Open/Unassigned": 1,
  "Open/Assigned": 2,
  "Pending": 3,
  "Resolved": 4,
}

const priorityOrder = {
  "Urgent": 1,
  "High": 2,
  "Medium": 3,
  "Low": 4,
}

function sortTickets(tickets) {
  return [...tickets].sort((a, b) => {
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[a.status] - statusOrder[b.status]
    }
    return priorityOrder[a.priority] - priorityOrder[b.priority]
  })
}

function getPriorityColor(priority) {
  if (priority === "Urgent") return { background: "#FEE2E2", color: "#DC2626" }
  if (priority === "High") return { background: "#FFEDD5", color: "#EA580C" }
  if (priority === "Medium") return { background: "#FEF9C3", color: "#D97706" }
  return { background: "#EFF6FF", color: "#3B82F6" }
}

function getTimeInfo(ticket) {
  const created = new Date(ticket.createdAt)
  if (ticket.status === "Resolved" && ticket.resolvedAt) {
    const resolved = new Date(ticket.resolvedAt)
    const diffMs = resolved - created
    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60))
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
    return { label: "Resolved in", value: `${diffHrs}h ${diffMins}m`, color: "#16A34A" }
  } else {
    const now = new Date()
    const diffMs = now - created
    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60))
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
    return { label: "Open for", value: `${diffHrs}h ${diffMins}m`, color: diffHrs > 24 ? "#DC2626" : "#D97706" }
  }
}

function isSLABreached(ticket) {
  if (ticket.status === "Resolved") return false
  const slaHours = { "Urgent": 2, "High": 8, "Medium": 24, "Low": 72 }
  const created = new Date(ticket.createdAt)
  const now = new Date()
  const diffHrs = (now - created) / (1000 * 60 * 60)
  return diffHrs > slaHours[ticket.priority]
}

const agents = [
  { name: "Khushboo R.", level: "Senior", skills: ["Network", "Software"] },
  { name: "Agent Mike", level: "Senior", skills: ["Network", "Hardware"] },
  { name: "Agent Sara", level: "Junior", skills: ["Software", "Email"] },
  { name: "Agent John", level: "Junior", skills: ["Hardware", "Email"] },
]

function autoAssign(category, priority, ticketList) {
  const isCritical = priority === "Urgent" || priority === "High"
  let matched = agents.filter(a => a.skills.includes(category))
  if (matched.length === 0) matched = [...agents]
  if (isCritical) {
    const seniors = matched.filter(a => a.level === "Senior")
    if (seniors.length > 0) matched = seniors
  } else {
    const juniors = matched.filter(a => a.level === "Junior")
    if (juniors.length > 0) matched = juniors
  }
  const agentLoad = matched.map(agent => ({
    agent,
    count: ticketList.filter(t => t.assignedTo === agent.name && t.status !== "Resolved").length
  }))
  agentLoad.sort((a, b) => a.count - b.count)
  return agentLoad[0].agent.name
}
function Dashboard({ onLogout, role }) {
  const [showForm, setShowForm] = useState(false)
  const [ticketList, setTicketList] = useState([])
  const [newTitle, setNewTitle] = useState("")
  const [newDescription, setNewDescription] = useState("")
  const [newPriority, setNewPriority] = useState("Low")
  const [newCategory, setNewCategory] = useState("Network")
  const [search, setSearch] = useState("")
  const [selectedTicket, setSelectedTicket] = useState(null)
  const [activeTab, setActiveTab] = useState("tickets")
  const [loading, setLoading] = useState(true)

  const user = JSON.parse(localStorage.getItem("user") || "{}")

  useEffect(() => {
    fetchTickets()
  }, [])

  async function fetchTickets() {
    try {
      const token = localStorage.getItem("token")
      const response = await fetch("http://localhost:5000/api/tickets", {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await response.json()
      setTicketList(data)
      setLoading(false)
    } catch (err) {
      console.error("Failed to fetch tickets:", err)
      setLoading(false)
    }
  }

  const roleFilteredTickets = ticketList.filter(t => {
    if (role === "superadmin" || role === "admin") return true
    if (role === "agent") return t.assignedTo === user.name
    if (role === "client") return t.clientEmail === user.email
    return false
  })

  const filteredTickets = roleFilteredTickets.filter(t =>
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    t.ticketId.toLowerCase().includes(search.toLowerCase())
  )

  const totalTickets = roleFilteredTickets.length
  const unassignedTickets = roleFilteredTickets.filter(t => t.status === "Open/Unassigned").length
  const inProgressTickets = roleFilteredTickets.filter(t => t.status === "Open/Assigned").length
  const pendingTickets = roleFilteredTickets.filter(t => t.status === "Pending").length
  const resolvedTickets = roleFilteredTickets.filter(t => t.status === "Resolved").length

  async function handleSubmit() {
    if (newTitle === "") return
    const assignedAgent = autoAssign(newCategory, newPriority, ticketList)
    const newId = ticketList.length + 1
    const ticketId = `KS-${String(newId).padStart(3, '0')}`

    try {
      const token = localStorage.getItem("token")
      await fetch("http://localhost:5000/api/tickets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ticketId,
          title: newTitle,
          description: newDescription,
          category: newCategory,
          priority: newPriority,
          assignedTo: assignedAgent,
          clientEmail: user.email
        })
      })
      await fetchTickets()
      setNewTitle("")
      setNewDescription("")
      setNewPriority("Low")
      setNewCategory("Network")
      setShowForm(false)
    } catch (err) {
      console.error("Failed to create ticket:", err)
    }
  }

  async function handleAssign(ticketId, agent) {
    try {
      const token = localStorage.getItem("token")
      await fetch(`http://localhost:5000/api/tickets/${ticketId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          status: agent === "" ? "Open/Unassigned" : "Open/Assigned",
          assignedTo: agent,
          resolvedAt: null
        })
      })
      await fetchTickets()
    } catch (err) {
      console.error("Failed to assign ticket:", err)
    }
  }

  async function handleResolve(ticketId) {
    try {
      const token = localStorage.getItem("token")
      await fetch(`http://localhost:5000/api/tickets/${ticketId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          status: "Resolved",
          assignedTo: null,
          resolvedAt: new Date().toISOString()
        })
      })
      await fetchTickets()
    } catch (err) {
      console.error("Failed to resolve ticket:", err)
    }
  }

  const avgResolutionTime = () => {
    const resolved = ticketList.filter(t => t.status === "Resolved" && t.resolvedAt)
    if (resolved.length === 0) return "No data"
    const total = resolved.reduce((sum, t) => {
      const diff = new Date(t.resolvedAt) - new Date(t.createdAt)
      return sum + diff
    }, 0)
    const avgHrs = Math.floor(total / resolved.length / (1000 * 60 * 60))
    const avgMins = Math.floor((total / resolved.length % (1000 * 60 * 60)) / (1000 * 60))
    return `${avgHrs}h ${avgMins}m`
  }

  const agentPerformance = agents.map(agent => ({
    name: agent.name,
    resolved: ticketList.filter(t => t.assignedTo === agent.name && t.status === "Resolved").length,
    open: ticketList.filter(t => t.assignedTo === agent.name && t.status !== "Resolved").length,
  }))

  const getRoleLabel = () => {
    if (role === "superadmin") return "🔴 Super Admin"
    if (role === "admin") return "🟡 Admin"
    if (role === "agent") return "🟢 Agent"
    return "🔵 Client"
  }

  if (loading) return <div style={{ padding: "40px", textAlign: "center" }}>Loading KrishaSure... ⏳</div>

  return (
    <div>
      <nav className="dash-nav">
        <div className="dash-nav-left">
          <img src="/Logo.jpeg" alt="Logo" className="dash-logo" />
          <span className="dash-brand">KrishaSure</span>
        </div>
        <div className="dash-nav-right">
          <span className="role-label">{getRoleLabel()}</span>
          {(role === "superadmin" || role === "admin") && (
            <>
              <button
                className={activeTab === "tickets" ? "create-ticket-btn" : "logout-btn"}
                onClick={() => setActiveTab("tickets")}
              >
                🎫 Tickets
              </button>
              <button
                className={activeTab === "reports" ? "create-ticket-btn" : "logout-btn"}
                onClick={() => setActiveTab("reports")}
              >
                📊 Reports
              </button>
            </>
          )}
          <button className="create-ticket-btn" onClick={() => setShowForm(true)}>+ Create Ticket</button>
          <button className="logout-btn" onClick={onLogout}>Logout</button>
        </div>
      </nav>

      <div className="dash-container">
        {activeTab === "tickets" && (
          <>
            <div className="stats-row">
              <div className="stat-card"><h3>Total</h3><p>{totalTickets}</p></div>
              <div className="stat-card"><h3>Unassigned</h3><p>{unassignedTickets}</p></div>
              <div className="stat-card"><h3>In Progress</h3><p>{inProgressTickets}</p></div>
              <div className="stat-card"><h3>Pending</h3><p>{pendingTickets}</p></div>
              <div className="stat-card"><h3>Resolved</h3><p>{resolvedTickets}</p></div>
            </div>

            <div className="search-bar">
              <input
                type="text"
                placeholder="Search tickets by title or ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <h2>Tickets</h2>

            {["Open/Unassigned", "Open/Assigned", "Pending", "Resolved"].map(status => {
              const statusTickets = sortTickets(filteredTickets.filter(t => t.status === status))
              if (statusTickets.length === 0) return null
              return (
                <div key={status} className="ticket-group">
                  <h3 className="status-heading">{status}</h3>
                  {statusTickets.map(ticket => (
                    <div
                      className={`ticket-card ${ticket.priority.toLowerCase()}`}
                      key={ticket.id}
                      onClick={() => setSelectedTicket(ticket)}
                      style={{ cursor: "pointer" }}
                    >
                      <div className="ticket-header">
                        <div>
                          <span className="ticket-id">{ticket.ticketId} • {ticket.category}</span>
                          <h3>{ticket.title}</h3>
                        </div>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <span className="priority-badge" style={getPriorityColor(ticket.priority)}>
                            {ticket.priority}
                          </span>
                          {isSLABreached(ticket) && (
                            <span className="sla-badge">🔴 SLA Breached</span>
                          )}
                        </div>
                      </div>
                      <div className="ticket-footer" onClick={e => e.stopPropagation()}>
                        <span className="assigned-label">👤 {ticket.assignedTo || "Unassigned"}</span>
                        <span className="time-label" style={{ color: getTimeInfo(ticket).color }}>
                          ⏱️ {getTimeInfo(ticket).label}: {getTimeInfo(ticket).value}
                        </span>
                        <div className="ticket-actions">
                          {(role === "superadmin" || role === "admin") && (
                            <select
                              className="assign-select"
                              value={ticket.assignedTo || ""}
                              onChange={(e) => handleAssign(ticket.id, e.target.value)}
                            >
                              <option value="">Unassigned</option>
                              {agents.map(agent => (
                                <option key={agent.name} value={agent.name}>{agent.name}</option>
                              ))}
                            </select>
                          )}
                          {ticket.status !== "Resolved" && role !== "client" && (
                            <button className="resolve-btn" onClick={() => handleResolve(ticket.id)}>
                              ✅ Resolve
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}
          </>
        )}

        {activeTab === "reports" && (role === "superadmin" || role === "admin") && (
          <>
            <h2>Reports</h2>
            <div className="stats-row">
              <div className="stat-card"><h3>Total Tickets</h3><p>{ticketList.length}</p></div>
              <div className="stat-card"><h3>Resolved</h3><p>{ticketList.filter(t => t.status === "Resolved").length}</p></div>
              <div className="stat-card"><h3>SLA Breached</h3><p>{ticketList.filter(t => isSLABreached(t)).length}</p></div>
              <div className="stat-card"><h3>Avg Resolution</h3><p style={{ fontSize: "18px" }}>{avgResolutionTime()}</p></div>
            </div>

            <h3 style={{ color: "#0A2540", margin: "24px 0 16px" }}>Agent Performance</h3>
            {agentPerformance.map(agent => (
              <div key={agent.name} className="ticket-card low" style={{ marginBottom: "12px" }}>
                <div className="ticket-header">
                  <h3>👤 {agent.name}</h3>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <span className="priority-badge" style={{ background: "#F0FDF4", color: "#16A34A" }}>
                      ✅ Resolved: {agent.resolved}
                    </span>
                    <span className="priority-badge" style={{ background: "#EFF6FF", color: "#2563EB" }}>
                      🎫 Open: {agent.open}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {showForm && (
        <div className="modal-overlay">
          <div className="modal-box">
            <h2>Create New Ticket</h2>
            <p className="ticket-id-preview">Ticket ID: KS-{String(ticketList.length + 1).padStart(3, '0')}</p>
            <input
              type="text"
              placeholder="Ticket title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <textarea
              placeholder="Describe the issue..."
              rows="4"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
            />
            <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
              <option>Network</option>
              <option>Software</option>
              <option>Hardware</option>
              <option>Email</option>
            </select>
            <select value={newPriority} onChange={(e) => setNewPriority(e.target.value)}>
              <option>Low</option>
              <option>Medium</option>
              <option>High</option>
              <option>Urgent</option>
            </select>
            <div className="modal-buttons">
              <button className="create-ticket-btn" onClick={handleSubmit}>Submit Ticket</button>
              <button className="logout-btn" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {selectedTicket && (
        <TicketDetail
          ticket={selectedTicket}
          agents={agents}
          role={role}
          onClose={() => setSelectedTicket(null)}
          onResolve={(id) => { handleResolve(id); setSelectedTicket(null) }}
          onAssign={(id, agent) => {
            handleAssign(id, agent)
            setSelectedTicket({ ...selectedTicket, assignedTo: agent, status: agent === "" ? "Open/Unassigned" : "Open/Assigned" })
          }}
        />
      )}

    </div>
  )
}

export default Dashboard