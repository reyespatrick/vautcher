// Restaurant info — single source of truth for contact details.

export const site = {
  name: 'La Gioconda',
  tagline: 'Votre restaurant napolitain à Cointrin',
  address: 'Avenue Louis-Casaï 81, 1216 Cointrin',
  phone: '+41 22 798 96 05',
  phoneHref: 'tel:+41227989605',
  email: 'nicola.cassella@gmail.com',
  mapsHref: 'https://www.google.com/maps/search/?api=1&query=Avenue+Louis-Casa%C3%AF+81+1216+Cointrin',
  hours: [
    { days: 'Lundi – Dimanche', service: 'Midi', time: '11h30 – 14h00' },
    { days: 'Lundi – Dimanche', service: 'Soir', time: '18h30 – 23h30' }
  ]
}

export const gallery = [
  { src: '/assets/photo1.jpg', caption: 'La salle vitrée' },
  { src: '/assets/photo2.jpg', caption: 'Le bar' },
  { src: '/assets/photo3.jpg', caption: 'La terrasse' },
  { src: '/assets/photo4.jpg', caption: 'Da Vinci, bar à vin' }
]
