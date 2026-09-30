import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Last line of defence: a render error shows a recoverable message instead of a blank page. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-screen">
        <div className="auth-card">
          <h1 className="auth-title">משהו השתבש</h1>
          <p className="muted">אירעה שגיאה בלתי צפויה בטעינת הדף.</p>
          <pre className="error-detail" dir="ltr">{this.state.error.message}</pre>
          <div className="row gap">
            <button className="btn filled" onClick={() => window.location.reload()}>טעינה מחדש</button>
            <button
              className="btn text"
              onClick={() => {
                window.location.hash = '#/';
                this.setState({ error: null });
              }}
            >
              חזרה לדף הבית
            </button>
          </div>
        </div>
      </div>
    );
  }
}
