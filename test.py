import pandas as pd
import numpy as np
import os

# Le chemin exact vers vos données
chemin_dossier = r"c:\peaksoft-security-platform-main\peaksoft-security-platform-main\Data\Raw\telemtry_data\IoT_filtered_normal"
fichiers_logs = ['IoT_normal_modbus_1.log', 'IoT_normal_modbus_2.log', 'IoT_normal_modbus_3.log']

# La fonction pour injecter les erreurs (NaN et Outliers)
def salir_dataset(df, fraction_outliers=0.01, fraction_nan=0.015):
    df_sale = df.copy()
    colonnes_numeriques = df_sale.select_dtypes(include=[np.number]).columns
    
    for col in colonnes_numeriques:
        n_rows = len(df_sale)
        
        # Ajout de NaN (Micro-coupures)
        n_nan = int(n_rows * fraction_nan)
        idx_nan = np.random.choice(df_sale.index, n_nan, replace=False)
        df_sale.loc[idx_nan, col] = np.nan
        
        # Ajout d'Outliers (Interférences)
        n_outliers = int(n_rows * fraction_outliers)
        idx_outliers = np.random.choice(df_sale.index, n_outliers, replace=False)
        max_val = df_sale[col].max()
        if not pd.isna(max_val) and max_val != 0:
            df_sale.loc[idx_outliers, col] = df_sale.loc[idx_outliers, col] + (max_val * np.random.uniform(1.5, 3, n_outliers))
            
    return df_sale

# Traitement automatique des 3 fichiers
for nom_fichier in fichiers_logs:
    chemin_complet = os.path.join(chemin_dossier, nom_fichier)
    
    # 1. Lecture intelligente du format "[val1,val2,val3,val4]"
    df = pd.read_csv(chemin_complet, header=None, sep=',', engine='python')
    # On enlève les crochets '[' au début et ']' à la fin
    df[0] = df[0].astype(str).str.replace('[', '', regex=False).replace('', np.nan).astype(float)
    df[df.columns[-1]] = df[df.columns[-1]].astype(str).str.replace(']', '', regex=False).replace('', np.nan).astype(float)
    
    # On renomme proprement les colonnes
    df.columns = [f'Capteur_{i+1}' for i in range(len(df.columns))]
    
    # 2. On salit secrètement le dataset
    df_corrompu = salir_dataset(df)
    
    # 3. On remet le format d'origine avec les crochets
    col_deb = df_corrompu.columns[0]
    col_fin = df_corrompu.columns[-1]
    df_corrompu[col_deb] = df_corrompu[col_deb].apply(lambda x: f"[{x}" if pd.notna(x) else "[")
    df_corrompu[col_fin] = df_corrompu[col_fin].apply(lambda x: f"{x}]" if pd.notna(x) else "]")
    
    # 4. On écrase le fichier log original (sans en-tête)
    df_corrompu.to_csv(chemin_complet, index=False, header=False)
    print(f"Fichier original écrase avec le bruit : {chemin_complet}")
