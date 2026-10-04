import React, { useState, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AGENTS } from '../../shared/config';
import type { AgentId } from '../../shared/agents';
import { analyzeGltf, type AnalysisResult } from './analyze';
import { checkClips, guessAgentFromPath, type ClipCheckResult } from './requiredClips';
import { Turntable } from './Turntable';

const AGENT_OPTIONS: { id: AgentId; label: string }[] = [
  { id: 'chipmunk', label: 'Chip (Chipmunk)' },
  { id: 'beaver', label: 'Archie (Beaver)' },
  { id: 'wolf', label: 'Warden (Wolf)' },
  { id: 'workspace', label: 'Pixel (Workspace)' },
  { id: 'eagle', label: 'Scout (Eagle)' },
  { id: 'ants', label: 'Swarm (Ants)' },
  { id: 'butterfly', label: 'Iris (Butterfly)' },
  { id: 'nightingale', label: 'Celene (Nightingale)' }
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const AssetLabApp: React.FC = () => {
  const [modelFile, setModelFile] = useState<{ name: string; size: number } | null>(null);
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const [animations, setAnimations] = useState<THREE.AnimationClip[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [characterConfig, setCharacterConfig] = useState<{
    fileName: string;
    clipMap?: Record<string, string>;
  } | null>(null);
  const [agentId, setAgentId] = useState<AgentId>('chipmunk');
  const [activeClipName, setActiveClipName] = useState<string | null>(null);
  const [loop, setLoop] = useState<boolean>(true);
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const glbInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const handleGlbFile = async (file: File) => {
    try {
      setErrorMessage(null);
      const buffer = await file.arrayBuffer();
      const loader = new GLTFLoader();
      const gltf = await loader.parseAsync(buffer, '');

      const analyzed = analyzeGltf(gltf.scene, gltf.animations);
      const guessedAgent = guessAgentFromPath(file.name);

      setScene(gltf.scene);
      setAnimations(gltf.animations);
      setAnalysis(analyzed);
      setModelFile({ name: file.name, size: file.size });
      setAgentId(guessedAgent);

      // Default active clip: 'Idle' if available, else first clip
      const hasIdle = gltf.animations.some((c) => c.name === 'Idle');
      setActiveClipName(hasIdle ? 'Idle' : gltf.animations[0]?.name ?? null);
    } catch (err) {
      setErrorMessage(
        `Failed to parse 3D model (${file.name}): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleJsonFile = async (file: File) => {
    try {
      setErrorMessage(null);
      const text = await file.text();
      const parsed = JSON.parse(text);
      const clipMap =
        parsed.clipMap && typeof parsed.clipMap === 'object'
          ? (parsed.clipMap as Record<string, string>)
          : undefined;

      setCharacterConfig({
        fileName: file.name,
        clipMap
      });
    } catch (err) {
      setErrorMessage(
        `Failed to parse character configuration (${file.name}): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const processFileList = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.glb') || lower.endsWith('.gltf')) {
        void handleGlbFile(file);
      } else if (lower.endsWith('.json')) {
        void handleJsonFile(file);
      } else {
        setErrorMessage(`Unsupported file format: ${file.name}. Expected .glb, .gltf, or .json`);
      }
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFileList(e.dataTransfer.files);
    }
  };

  // Run clip checks
  const clipResults = useMemo(() => {
    const foundClips = analysis?.clips ?? [];
    return checkClips(agentId, foundClips, characterConfig?.clipMap);
  }, [agentId, analysis, characterConfig]);

  const requiredClips = useMemo(
    () => clipResults.filter((r) => r.tier === 'required'),
    [clipResults]
  );
  const recommendedClips = useMemo(
    () => clipResults.filter((r) => r.tier === 'recommended'),
    [clipResults]
  );
  const signatureClips = useMemo(
    () => clipResults.filter((r) => r.tier === 'signature'),
    [clipResults]
  );

  const requiredFoundCount = requiredClips.filter((r) => r.found).length;
  const isReady = requiredClips.length > 0 && requiredFoundCount === requiredClips.length;

  const hasMouthOpen = analysis?.morphTargets.includes('MouthOpen') ?? false;
  const hasBlink = analysis?.morphTargets.includes('Blink') ?? false;
  const triangleBudgetWarning = (analysis?.triangles ?? 0) > 30000;

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: '#0f172a',
        color: '#f8fafc',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
      }}
    >
      {/* Hidden file pickers */}
      <input
        ref={glbInputRef}
        type="file"
        accept=".glb,.gltf"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) processFileList(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={jsonInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) processFileList(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Top Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 20px',
          borderBottom: '1px solid #334155',
          backgroundColor: '#1e293b',
          zIndex: 10
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', color: '#60a5fa' }}>
            ADE Asset Lab
          </span>
          <span
            style={{
              fontSize: 12,
              backgroundColor: '#334155',
              color: '#cbd5e1',
              padding: '2px 8px',
              borderRadius: 4
            }}
          >
            Model Verification
          </span>
        </div>

        {/* Animal Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ fontSize: 13, color: '#94a3b8' }}>Target Animal:</label>
          <select
            aria-label="Target Animal"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value as AgentId)}
            style={{
              backgroundColor: '#0f172a',
              color: '#f8fafc',
              border: '1px solid #475569',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 13,
              cursor: 'pointer'
            }}
          >
            {AGENT_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Action buttons */}
          <button
            onClick={() => glbInputRef.current?.click()}
            style={{
              backgroundColor: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Choose .glb
          </button>
          <button
            onClick={() => jsonInputRef.current?.click()}
            style={{
              backgroundColor: '#334155',
              color: '#e2e8f0',
              border: '1px solid #475569',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 13,
              cursor: 'pointer'
            }}
          >
            Choose character.json
          </button>
        </div>
      </header>

      {/* Error message banner */}
      {errorMessage && (
        <div
          role="alert"
          style={{
            backgroundColor: '#7f1d1d',
            color: '#fecaca',
            padding: '10px 20px',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #991b1b'
          }}
        >
          <span>⚠️ {errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fecaca',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Dragging Overlay */}
      {isDragging && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(59, 130, 246, 0.25)',
            border: '3px dashed #60a5fa',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            pointerEvents: 'none'
          }}
        >
          <div
            style={{
              backgroundColor: '#1e293b',
              padding: '24px 40px',
              borderRadius: 12,
              fontSize: 18,
              fontWeight: 600,
              color: '#f8fafc',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
            }}
          >
            Drop .glb or character.json here
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Left: Turntable Viewport */}
        <div
          style={{
            flex: 1,
            position: 'relative',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {scene ? (
            <>
              <Turntable
                scene={scene}
                animations={animations}
                activeClipName={activeClipName}
                loop={loop}
                autoRotate={autoRotate}
              />

              {/* Viewport Floating Controls */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 16,
                  left: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  backgroundColor: 'rgba(30, 41, 59, 0.85)',
                  padding: '8px 12px',
                  borderRadius: 8,
                  backdropFilter: 'blur(4px)',
                  border: '1px solid #475569'
                }}
              >
                <button
                  onClick={() => setAutoRotate(!autoRotate)}
                  style={{
                    backgroundColor: autoRotate ? '#3b82f6' : '#334155',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    padding: '4px 10px',
                    fontSize: 12,
                    cursor: 'pointer'
                  }}
                >
                  {autoRotate ? 'Turntable: Rotating' : 'Turntable: Paused'}
                </button>

                <button
                  onClick={() => setLoop(!loop)}
                  style={{
                    backgroundColor: loop ? '#4f46e5' : '#334155',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    padding: '4px 10px',
                    fontSize: 12,
                    cursor: 'pointer'
                  }}
                >
                  {loop ? 'Mode: Loop' : 'Mode: Play Once'}
                </button>

                {activeClipName && (
                  <button
                    onClick={() => setActiveClipName(null)}
                    style={{
                      backgroundColor: '#ef4444',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      padding: '4px 10px',
                      fontSize: 12,
                      cursor: 'pointer'
                    }}
                  >
                    ⏹ Stop ({activeClipName})
                  </button>
                )}
              </div>
            </>
          ) : (
            <div
              onClick={() => glbInputRef.current?.click()}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                backgroundColor: '#0f172a',
                color: '#64748b'
              }}
            >
              <div
                style={{
                  border: '2px dashed #334155',
                  padding: 40,
                  borderRadius: 12,
                  textAlign: 'center',
                  maxWidth: 420
                }}
              >
                <div style={{ fontSize: 36, marginBottom: 12 }}>📦</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0', marginBottom: 8 }}>
                  Drop a .glb file here
                </div>
                <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>
                  or click to select. You can also drop an accompanying <code>character.json</code> to
                  verify clipMap aliases.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Inspection & Checklist Panel */}
        <aside
          style={{
            width: 380,
            borderLeft: '1px solid #334155',
            backgroundColor: '#1e293b',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            padding: 18,
            gap: 18
          }}
        >
          {/* File Status & Summary */}
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#f8fafc' }}>
                {modelFile ? modelFile.name : 'No model loaded'}
              </h2>
              {modelFile && (
                <span style={{ fontSize: 12, color: '#94a3b8' }}>{formatBytes(modelFile.size)}</span>
              )}
            </div>
            {characterConfig && (
              <div style={{ fontSize: 12, color: '#a78bfa', marginTop: 4 }}>
                📄 {characterConfig.fileName} (
                {characterConfig.clipMap ? `${Object.keys(characterConfig.clipMap).length} aliases` : 'no clipMap'}
                )
              </div>
            )}

            {/* Checklist summary banner */}
            <div
              style={{
                marginTop: 12,
                padding: '10px 14px',
                borderRadius: 8,
                backgroundColor: isReady ? '#064e3b' : '#451a03',
                border: `1px solid ${isReady ? '#059669' : '#d97706'}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 4
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: isReady ? '#6ee7b7' : '#fcd34d' }}>
                Ready: {requiredFoundCount}/{requiredClips.length} required
              </div>
              <div style={{ fontSize: 12, color: isReady ? '#a7f3d0' : '#fde68a' }}>
                {isReady
                  ? 'All core clips verified. Ready for ADE.'
                  : `Missing ${requiredClips.length - requiredFoundCount} required clip(s).`}
              </div>
            </div>
          </section>

          {/* Model Statistics & Budgets */}
          {analysis && (
            <section style={{ borderTop: '1px solid #334155', paddingTop: 14 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', margin: '0 0 10px 0' }}>
                Model Metrics
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                <div
                  style={{
                    backgroundColor: triangleBudgetWarning ? '#7f1d1d' : '#0f172a',
                    border: `1px solid ${triangleBudgetWarning ? '#ef4444' : '#334155'}`,
                    padding: 8,
                    borderRadius: 6
                  }}
                >
                  <div style={{ color: '#94a3b8' }}>Triangles</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: triangleBudgetWarning ? '#fca5a5' : '#f8fafc' }}>
                    {analysis.triangles.toLocaleString()}
                  </div>
                  {triangleBudgetWarning && (
                    <div style={{ fontSize: 10, color: '#f87171', marginTop: 2 }}>⚠️ Budget &gt; 30k</div>
                  )}
                </div>

                <div style={{ backgroundColor: '#0f172a', border: '1px solid #334155', padding: 8, borderRadius: 6 }}>
                  <div style={{ color: '#94a3b8' }}>Bones</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{analysis.bones}</div>
                </div>

                <div style={{ backgroundColor: '#0f172a', border: '1px solid #334155', padding: 8, borderRadius: 6 }}>
                  <div style={{ color: '#94a3b8' }}>Meshes</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{analysis.meshes}</div>
                </div>

                <div style={{ backgroundColor: '#0f172a', border: '1px solid #334155', padding: 8, borderRadius: 6 }}>
                  <div style={{ color: '#94a3b8' }}>Clips in File</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{analysis.clips.length}</div>
                </div>
              </div>

              <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8' }}>
                Bounds: {analysis.boundingBox.width.toFixed(2)} × {analysis.boundingBox.height.toFixed(2)} × {analysis.boundingBox.depth.toFixed(2)} m
              </div>
            </section>
          )}

          {/* Morph Targets Inspection */}
          {analysis && (
            <section style={{ borderTop: '1px solid #334155', paddingTop: 14 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', margin: '0 0 10px 0' }}>
                Morph Targets
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    borderRadius: 6,
                    backgroundColor: '#0f172a',
                    border: `1px solid ${hasMouthOpen ? '#059669' : '#dc2626'}`
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 500 }}>MouthOpen (Lip-sync)</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: hasMouthOpen ? '#4ade80' : '#f87171' }}>
                    {hasMouthOpen ? '✓ Found' : '✗ Missing'}
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    borderRadius: 6,
                    backgroundColor: '#0f172a',
                    border: `1px solid ${hasBlink ? '#059669' : '#dc2626'}`
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Blink (Random blink)</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: hasBlink ? '#4ade80' : '#f87171' }}>
                    {hasBlink ? '✓ Found' : '✗ Missing'}
                  </span>
                </div>

                {analysis.morphTargets.filter((m) => m !== 'MouthOpen' && m !== 'Blink').length > 0 && (
                  <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {analysis.morphTargets
                      .filter((m) => m !== 'MouthOpen' && m !== 'Blink')
                      .map((name) => (
                        <span
                          key={name}
                          style={{
                            fontSize: 11,
                            backgroundColor: '#334155',
                            padding: '2px 6px',
                            borderRadius: 4,
                            color: '#cbd5e1'
                          }}
                        >
                          {name}
                        </span>
                      ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Animation Checklist by Tier */}
          <section style={{ borderTop: '1px solid #334155', paddingTop: 14 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', margin: '0 0 10px 0' }}>
              Clip Checklist ({AGENTS[agentId]?.displayName ?? agentId})
            </h3>

            {/* Required Tier */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#60a5fa', marginBottom: 6 }}>
                Core Required (Tier 1)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {requiredClips.map((item) => (
                  <ClipChecklistRow
                    key={item.name}
                    item={item}
                    activeClipName={activeClipName}
                    onPlay={(name) => setActiveClipName(name)}
                  />
                ))}
              </div>
            </div>

            {/* Recommended Tier */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#c084fc', marginBottom: 6 }}>
                Recommended (Tier 2/3)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {recommendedClips.map((item) => (
                  <ClipChecklistRow
                    key={item.name}
                    item={item}
                    activeClipName={activeClipName}
                    onPlay={(name) => setActiveClipName(name)}
                  />
                ))}
              </div>
            </div>

            {/* Signature Tier */}
            {signatureClips.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#f472b6', marginBottom: 6 }}>
                  Signature Clips ({AGENTS[agentId]?.displayName ?? agentId})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {signatureClips.map((item) => (
                    <ClipChecklistRow
                      key={item.name}
                      item={item}
                      activeClipName={activeClipName}
                      onPlay={(name) => setActiveClipName(name)}
                    />
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* All Clips in Model (Player buttons) */}
          {animations.length > 0 && (
            <section style={{ borderTop: '1px solid #334155', paddingTop: 14 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', margin: '0 0 10px 0' }}>
                All Clips in Model ({animations.length})
              </h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {animations.map((clip) => {
                  const isPlaying = activeClipName === clip.name;
                  return (
                    <button
                      key={clip.name}
                      onClick={() => setActiveClipName(isPlaying ? null : clip.name)}
                      style={{
                        backgroundColor: isPlaying ? '#3b82f6' : '#0f172a',
                        color: isPlaying ? '#fff' : '#cbd5e1',
                        border: `1px solid ${isPlaying ? '#60a5fa' : '#334155'}`,
                        borderRadius: 6,
                        padding: '4px 8px',
                        fontSize: 12,
                        cursor: 'pointer'
                      }}
                    >
                      {isPlaying ? '▶ ' : ''}
                      {clip.name} ({clip.duration.toFixed(1)}s)
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
};

interface ClipChecklistRowProps {
  item: ClipCheckResult;
  activeClipName: string | null;
  onPlay: (clipName: string) => void;
}

const ClipChecklistRow: React.FC<ClipChecklistRowProps> = ({
  item,
  activeClipName,
  onPlay
}) => {
  const isPlaying = activeClipName === item.name || activeClipName === item.via;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '5px 8px',
        backgroundColor: '#0f172a',
        borderRadius: 4,
        fontSize: 12
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: item.found ? '#22c55e' : '#ef4444', fontWeight: 'bold' }}>
          {item.found ? '✓' : '✗'}
        </span>
        <span style={{ color: item.found ? '#f8fafc' : '#94a3b8' }}>{item.name}</span>
        {item.via && (
          <span style={{ fontSize: 10, color: '#38bdf8' }}>
            ({item.via})
          </span>
        )}
      </div>

      {item.found && (
        <button
          onClick={() => onPlay(item.via || item.name)}
          style={{
            backgroundColor: isPlaying ? '#2563eb' : '#334155',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '2px 6px',
            fontSize: 10,
            cursor: 'pointer'
          }}
        >
          {isPlaying ? 'Playing' : 'Play'}
        </button>
      )}
    </div>
  );
};
