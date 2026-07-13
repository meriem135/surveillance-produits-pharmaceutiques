"""
Module de desaisonnalisation saisonniere.
Corrige les valeurs des capteurs selon le jour de l'annee.
Utilisation: T_corrigee = T_reelle - seasonal_offset(dayofyear)
"""
import numpy as np
from datetime import datetime

class SeasonalAdjuster:
    """
    Ajuste les donnees des capteurs pour enlever l'effet saisonnier.
    
    Principe : on estime une sinusoide annuelle de la temperature
    et on la soustrait avant de donner les donnees au modele.
    Le modele (entraine sur le printemps) voit toujours des valeurs
    comparables, ete comme hiver.
    """
    
    def __init__(self, amplitude=8.0, peak_day=200):
        """
        Args:
            amplitude: Amplitude saisonniere en degres Celsius 
                      (ecart entre printemps et pic ete).
                      Par defaut 8°C pour un climat tempere.
            peak_day: Jour de l'annee du pic de temperature (200 = ~19 juillet)
        """
        self.amplitude = amplitude
        self.peak_day = peak_day
        # Phase calculee pour que le pic soit a peak_day
        self.phi = peak_day - 90  # decalage: printemps (jour 90) ~= offset 0
    
    def get_offset(self, dayofyear):
        """
        Calcule l'offset saisonnier pour un jour de l'annee donne.
        
        Args:
            dayofyear: Jour de l'annee (1-365)
            
        Returns:
            offset: Valeur a soustraire de la temperature
        """
        offset = self.amplitude * np.sin(2 * np.pi * (dayofyear - self.phi) / 365)
        
        # On cale pour que le printemps (jour ~90) ait offset ≈ 0
        # (car le modele a ete entraine sur des donnees de printemps)
        spring_offset = self.amplitude * np.sin(2 * np.pi * (90 - self.phi) / 365)
        offset = offset - spring_offset
        
        return offset
    
    def adjust(self, value, dayofyear):
        """
        Corrige une valeur pour enlever l'effet saisonnier.
        
        Args:
            value: Valeur brute du capteur
            dayofyear: Jour de l'annee (1-365)
            
        Returns:
            Valeur ajustee (comme si on etait au printemps)
        """
        return value - self.get_offset(dayofyear)
    
    def adjust_from_timestamp(self, value, timestamp):
        """Corrige une valeur a partir d'un timestamp."""
        doy = timestamp.timetuple().tm_yday
        return self.adjust(value, doy)


# Test rapide
if __name__ == "__main__":
    adj = SeasonalAdjuster(amplitude=8.0)
    print("Test des offsets saisonniers:")
    for doy, name in [(1, "Nouvel An"), (90, "Printemps"), (190, "Ete"), (280, "Automne"), (365, "Hiver")]:
        offset = adj.get_offset(doy)
        print(f"  Jour {doy:3d} ({name:12s}): offset = {offset:+.1f}°C")
    print(f"\nExemple: 30°C en ete -> {adj.adjust(30, 190):.1f}°C ajustes")
    print(f"Exemple: 5°C en hiver -> {adj.adjust(5, 20):.1f}°C ajustes")
    print(f"Exemple: 20°C au printemps -> {adj.adjust(20, 90):.1f}°C ajustes")
