import React from 'react';

/**
 * ErrorBoundary — captura erros de render no React e exibe uma tela de recuperação
 * em vez de travar toda a interface silenciosamente.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // eslint-disable-next-line no-console
    console.error('[Soundforge] Erro não tratado no render:', error, errorInfo);
  }

  handleReload() {
    window.location.reload();
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: '18px',
        padding: '40px',
        background: '#1a1713',
        color: '#fff4dd',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        textAlign: 'center'
      }}>
        <h2 style={{ margin: 0, fontFamily: "'Cinzel', serif", color: '#d9aa55', fontSize: '1.5rem' }}>
          Algo deu errado
        </h2>
        <p style={{ margin: 0, color: '#e2cfa8', maxWidth: '480px', lineHeight: 1.5 }}>
          Um erro inesperado aconteceu na interface. Você pode tentar recarregar o app.
        </p>
        {this.state.error?.message && (
          <pre style={{
            margin: 0,
            padding: '12px 16px',
            background: 'rgba(116, 48, 43, 0.22)',
            border: '1px solid rgba(242, 161, 161, 0.28)',
            borderRadius: '10px',
            color: '#f2c1b5',
            fontSize: '0.82rem',
            maxWidth: '560px',
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}>
            {this.state.error.message}
          </pre>
        )}
        <button
          type="button"
          onClick={this.handleReload}
          style={{
            padding: '12px 24px',
            borderRadius: '999px',
            border: '1px solid rgba(232, 181, 90, 0.42)',
            background: 'rgba(82, 58, 32, 0.72)',
            color: '#fff4dd',
            fontFamily: "'Cinzel', serif",
            fontSize: '0.9rem',
            cursor: 'pointer'
          }}
        >
          Recarregar
        </button>
      </div>
    );
  }
}
