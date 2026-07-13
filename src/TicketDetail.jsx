function TicketDetail({ ticket, agents, role, onClose, onResolve, onAssign }) {
  return (
    <div className="modal-overlay">
      <div className="detail-box">

        {/* Header */}
        <div className="detail-header">
          <div>
            <span className="ticket-id">{ticket.ticketId} • {ticket.category}</span>
            <h2>{ticket.title}</h2>
          </div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Info Grid */}
        <div className="detail-grid">
          <div className="detail-item">
            <span className="detail-label">Status</span>
            <span className="detail-value">{ticket.status}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Priority</span>
            <span className="detail-value">{ticket.priority}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Assigned To</span>
            <span className="detail-value">{ticket.assignedTo || "Unassigned"}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Created</span>
            <span className="detail-value">{new Date(ticket.createdAt).toLocaleString()}</span>
          </div>
          {ticket.resolvedAt && (
            <div className="detail-item">
              <span className="detail-label">Resolved</span>
              <span className="detail-value">{new Date(ticket.resolvedAt).toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Description */}
        <div className="detail-section">
          <h3>Description</h3>
          <p>{ticket.description || "No description provided"}</p>
        </div>

        {/* Reassign — only for superadmin and admin */}
        {ticket.status !== "Resolved" && (role === "superadmin" || role === "admin") && (
          <div className="detail-section">
            <h3>Reassign Ticket</h3>
            <select
              className="assign-select"
              value={ticket.assignedTo || ""}
              onChange={(e) => onAssign(ticket.id, e.target.value)}
            >
              <option value="">Unassigned</option>
              {agents.map(agent => (
                <option key={agent.name} value={agent.name}>{agent.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Actions */}
        <div className="detail-actions">
          {ticket.status !== "Resolved" && role !== "client" && (
            <button className="resolve-btn" onClick={() => { onResolve(ticket.id); onClose(); }}>
              ✅ Resolve Ticket
            </button>
          )}
          <button className="logout-btn" onClick={onClose}>Close</button>
        </div>

      </div>
    </div>
  )
}

export default TicketDetail