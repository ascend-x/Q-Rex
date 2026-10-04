import { useEffect, useState } from 'react'
import Home from './Home.jsx'
import App from './App.jsx'

// Hash routing keeps the build a single offline file: "#/app" = workstation, anything else = home page.
const route = () => (window.location.hash.startsWith('#/app') ? 'app' : 'home')

export default function Root() {
  const [page, setPage] = useState(route)
  useEffect(() => {
    const on = () => setPage((p) => { const n = route(); if (n !== p) window.scrollTo(0, 0); return n })
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  useEffect(() => { document.body.dataset.page = page }, [page])
  return page === 'app' ? <App /> : <Home />
}
