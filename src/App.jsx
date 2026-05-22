import { Routes, Route } from 'react-router-dom'
import Layout from './Layout.jsx'
import Home from './pages/Home.jsx'
import Lease from './pages/Lease.jsx'
import Guide from './pages/Guide.jsx'
import Settled from './pages/Settled.jsx'
export default function App() {
  return (
    <Routes>
      <Route path="/"                element={<Layout city="melbourne"><Home /></Layout>} />
      <Route path="/lease"           element={<Layout city="melbourne"><Lease /></Layout>} />
      <Route path="/guide"           element={<Layout city="melbourne"><Guide /></Layout>} />
      <Route path="/settled"         element={<Layout city="melbourne"><Settled /></Layout>} />
      <Route path="/sydney"          element={<Layout city="sydney"><Home /></Layout>} />
      <Route path="/lease-sydney"    element={<Layout city="sydney"><Lease /></Layout>} />
      <Route path="/guide-sydney"    element={<Layout city="sydney"><Guide /></Layout>} />
      <Route path="/settled-sydney"  element={<Layout city="sydney"><Settled /></Layout>} />
      <Route path="/brisbane"        element={<Layout city="brisbane"><Home /></Layout>} />
      <Route path="/lease-brisbane"  element={<Layout city="brisbane"><Lease /></Layout>} />
      <Route path="/guide-brisbane"  element={<Layout city="brisbane"><Guide /></Layout>} />
      <Route path="/settled-brisbane"element={<Layout city="brisbane"><Settled /></Layout>} />
    </Routes>
  )
}
