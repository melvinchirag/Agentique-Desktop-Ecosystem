import React, { useEffect, useState } from 'react';
import type { AdeApi } from '../../shared/ipc';
import type { AgentId } from '../../shared/agents';
import { AGENTS } from '../../shared/config';

interface MemoryItem {
  id: string;
  memory: string;
}

interface MemoriesTabProps {
  api: AdeApi;
  selectedAgentId: AgentId;
  onSelectAgent: (id: AgentId) => void;
}

export const MemoriesTab: React.FC<MemoriesTabProps> = ({
  api,
  selectedAgentId,
  onSelectAgent,
}) => {
  // Core animals for memory picker
  const memoryAgentIds: AgentId[] = ['chipmunk', 'workspace', 'beaver', 'eagle', 'ants'];

  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const isWarden = selectedAgentId === 'wolf';

  const loadMemories = async (agentId: AgentId) => {
    if (agentId === 'wolf') {
      setMemories([]);
      return;
    }
    setIsLoading(true);
    try {
      const data = await api.getMemories(agentId);
      setMemories(Array.isArray(data) ? data : []);
    } catch {
      setMemories([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setSearchQuery('');
    setEditingId(null);
    void loadMemories(selectedAgentId);
  }, [selectedAgentId]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isWarden) return;

    const trimmed = searchQuery.trim();
    if (!trimmed) {
      void loadMemories(selectedAgentId);
      return;
    }

    setIsLoading(true);
    try {
      const data = await api.searchMemories(selectedAgentId, trimmed);
      setMemories(Array.isArray(data) ? data : []);
    } catch {
      setMemories([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (memoryId: string) => {
    try {
      await api.deleteMemory(selectedAgentId, memoryId);
      setMemories((prev) => prev.filter((m) => m.id !== memoryId));
    } catch {
      // Ignore
    }
  };

  const handleStartEdit = (m: MemoryItem) => {
    setEditingId(m.id);
    setEditText(m.memory);
  };

  const handleSaveEdit = async (memoryId: string) => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    try {
      await api.updateMemory(selectedAgentId, memoryId, trimmed);
      setMemories((prev) =>
        prev.map((m) => (m.id === memoryId ? { ...m, memory: trimmed } : m))
      );
      setEditingId(null);
    } catch {
      // Ignore
    }
  };

  return (
    <div className="hub-memories-container" aria-label="Memories manager">
      {/* Animal picker */}
      <div className="hub-animal-picker" role="tablist" aria-label="Select agent for memories">
        {memoryAgentIds.map((id) => (
          <button
            key={id}
            type="button"
            className={`hub-picker-chip ${selectedAgentId === id ? 'active' : ''}`}
            onClick={() => onSelectAgent(id)}
            aria-label={`Select ${AGENTS[id]?.displayName ?? id}`}
          >
            {AGENTS[id]?.displayName ?? id}
          </button>
        ))}
      </div>

      {isWarden ? (
        <div style={{ padding: 16, color: 'var(--hub-text-muted)', textAlign: 'center' }}>
          🛡️ Warden has memory OFF by design (guardian safety rule).
        </div>
      ) : (
        <>
          {/* Search box */}
          <form className="hub-search-box" onSubmit={handleSearch}>
            <input
              type="text"
              className="hub-search-input"
              placeholder={`Search ${AGENTS[selectedAgentId]?.displayName ?? selectedAgentId}'s memories...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search memories"
            />
            <button type="submit" className="hub-tray-btn" aria-label="Submit search">
              Search
            </button>
            {searchQuery && (
              <button
                type="button"
                className="hub-icon-btn"
                onClick={() => {
                  setSearchQuery('');
                  void loadMemories(selectedAgentId);
                }}
              >
                ✕
              </button>
            )}
          </form>

          {/* Memory items */}
          <div className="hub-memory-list">
            {isLoading ? (
              <div style={{ color: 'var(--hub-text-muted)', padding: 12, textAlign: 'center' }}>
                Loading memories...
              </div>
            ) : memories.length === 0 ? (
              <div style={{ color: 'var(--hub-text-muted)', padding: 12, textAlign: 'center' }}>
                No memories found for {AGENTS[selectedAgentId]?.displayName ?? selectedAgentId}.
              </div>
            ) : (
              memories.map((m) => (
                <div key={m.id} className="hub-memory-item" data-testid={`memory-item-${m.id}`}>
                  {editingId === m.id ? (
                    <div>
                      <input
                        type="text"
                        className="hub-search-input"
                        style={{ width: '100%', marginBottom: 6 }}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        aria-label="Edit memory text"
                      />
                      <div className="hub-memory-actions">
                        <button
                          type="button"
                          className="hub-tray-btn"
                          onClick={() => handleSaveEdit(m.id)}
                          aria-label="Save memory"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="hub-icon-btn"
                          onClick={() => setEditingId(null)}
                          aria-label="Cancel editing"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ color: 'var(--hub-text-primary)', marginBottom: 4 }}>
                        {m.memory}
                      </div>
                      <div className="hub-memory-actions">
                        <button
                          type="button"
                          className="hub-icon-btn"
                          onClick={() => handleStartEdit(m)}
                          aria-label="Edit memory"
                        >
                          ✏ Edit
                        </button>
                        <button
                          type="button"
                          className="hub-icon-btn"
                          onClick={() => handleDelete(m.id)}
                          aria-label="Delete memory"
                        >
                          🗑 Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};
