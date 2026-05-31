<script setup>
import { site } from '../data/site'
</script>

<template>
  <div class="suspended">
    <div class="suspended__card">
      <div class="suspended__mark">vautcher</div>
      <h1>Ce restaurant n’utilise plus vautcher.</h1>
      <p class="lead">
        <template v-if="site.name">
          <strong>{{ site.name }}</strong>
        </template>
        <template v-else>Ce restaurant</template>
        n’est plus connecté à la plateforme vautcher.
      </p>
      <p class="muted">
        Pour réserver, contactez l’établissement directement.
      </p>
      <p class="vautcher-note">
        Vous êtes le propriétaire ?
        <a href="https://restowner.pages.dev/abonnement">Reprendre l’abonnement</a>.
      </p>
    </div>
  </div>
</template>

<style scoped>
.suspended {
  min-height: 100dvh;
  background: #1a1015;
  color: #f3e8db;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 20px;
  font-family: 'Montserrat', system-ui, sans-serif;
}
.suspended__card {
  max-width: 420px;
  width: 100%;
  background: #241823;
  border: 1px solid #3a2832;
  border-radius: 18px;
  padding: 30px 26px 26px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0,0,0,0.55);
}
.suspended__mark {
  font-family: 'Rufina', Georgia, serif;
  font-size: 0.7rem;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: #db7a98;
  margin-bottom: 18px;
}
h1 {
  font-family: 'Rufina', Georgia, serif;
  font-size: 1.4rem;
  line-height: 1.25;
  font-weight: 700;
  margin: 0 0 14px;
  color: #f3e8db;
}
.lead {
  font-size: 0.95rem;
  line-height: 1.5;
  margin: 0 0 10px;
}
.lead strong { color: #f2a4bd; }
.muted {
  color: #a09188;
  font-size: 0.85rem;
  margin: 0 0 22px;
  line-height: 1.5;
}
.vautcher-note {
  font-size: 0.78rem;
  color: #8c7f78;
  margin: 0;
  border-top: 1px solid #3a2832;
  padding-top: 14px;
  line-height: 1.5;
}
.vautcher-note a {
  color: #db7a98;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
</style>
