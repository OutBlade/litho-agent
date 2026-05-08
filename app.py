"""
LithoAgent — Streamlit chat interface.

Architecture:  Web UI (this file)  →  Agent (agent/core.py)  →  Tool sandbox (agent/tools/)
Inspired by vercel-labs/open-agents: chat-driven agent with durable tool dispatch.
"""

import streamlit as st
import plotly.graph_objects as go
import numpy as np
import json

from agent.core import run
from agent.tools.lithography import rayleigh_resolution, depth_of_focus
from agent.tools.implantation import gaussian_profile

st.set_page_config(page_title="LithoAgent", page_icon=None, layout="wide")

st.title("LithoAgent")
st.caption(
    "AI process engineering assistant — lithography, oxidation, implantation, yield. "
    "Powered by Claude with tool use."
)

# Sidebar: quick-access calculators that render plots directly
with st.sidebar:
    st.header("Quick Calculators")

    with st.expander("Resolution vs NA"):
        wl = st.selectbox(
            "Wavelength",
            [13.5, 193.0],
            format_func=lambda x: f"{x} nm ({'EUV' if x < 100 else 'ArF'})",
        )
        na_range = np.linspace(0.1, 1.35 if wl > 100 else 0.55, 100)
        res = [rayleigh_resolution(wl, na) for na in na_range]
        dof = [depth_of_focus(wl, na) for na in na_range]
        fig = go.Figure()
        fig.add_trace(
            go.Scatter(
                x=na_range, y=res, name="Resolution (nm)", line=dict(color="#4f8ef7")
            )
        )
        fig.add_trace(
            go.Scatter(
                x=na_range,
                y=dof,
                name="DOF (nm)",
                line=dict(color="#f7944f"),
                yaxis="y2",
            )
        )
        fig.update_layout(
            xaxis_title="NA",
            yaxis_title="Resolution (nm)",
            yaxis2=dict(title="DOF (nm)", overlaying="y", side="right"),
            height=260,
            margin=dict(l=0, r=0, t=10, b=30),
            legend=dict(x=0.5, y=1.15, orientation="h"),
        )
        st.plotly_chart(fig, use_container_width=True)

    with st.expander("Implant Profile"):
        species = st.selectbox("Species", ["boron", "phosphorus", "arsenic", "bf2"])
        energy = st.slider("Energy (keV)", 20, 200, 80)
        dose_exp = st.slider("Dose (10^x cm^-2)", 12, 16, 14)
        dose = 10**dose_exp
        try:
            prof = gaussian_profile(dose, energy, species, depth_points=300)
            depth = np.array(prof["depth_nm"])
            conc = np.array(prof["concentration_cm3"])
            fig2 = go.Figure()
            fig2.add_trace(go.Scatter(x=depth, y=conc, line=dict(color="#7cdd8f")))
            fig2.update_layout(
                xaxis_title="Depth (nm)",
                yaxis_title="Concentration (cm⁻³)",
                yaxis_type="log",
                height=240,
                margin=dict(l=0, r=0, t=10, b=30),
            )
            st.plotly_chart(fig2, use_container_width=True)
            st.caption(
                f"Rp = {prof['Rp_nm']} nm  |  dRp = {prof['dRp_nm']} nm  |  Peak = {prof['peak_concentration_cm3']:.2e} cm⁻³"
            )
        except Exception as e:
            st.error(str(e))

# Chat state
if "messages" not in st.session_state:
    st.session_state.messages = []
    st.session_state.messages.append(
        {
            "role": "assistant",
            "content": (
                "Hello. I'm LithoAgent — ask me anything about semiconductor processes. "
                "Try: *'What resolution can EUV reach at NA=0.33?'* or "
                "*'How long to grow 8nm SiO2 at 900°C dry?'* or "
                "*'Compare EUV and DUV for 7nm half-pitch.'*"
            ),
        }
    )

# Render history
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])

# Input
if prompt := st.chat_input("Ask a process engineering question..."):
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    with st.chat_message("assistant"):
        placeholder = st.empty()
        placeholder.markdown("Thinking...")

        # Build history in Claude API format (text-only for prior turns)
        api_history = [
            {"role": m["role"], "content": m["content"]}
            for m in st.session_state.messages
            if m["role"] in ("user", "assistant")
        ]

        try:
            response = run(api_history)
        except Exception as exc:
            response = f"Error: {exc}"

        placeholder.markdown(response)

    st.session_state.messages.append({"role": "assistant", "content": response})
